import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { connectionErrorResponse, loadAccountConnection } from '@/lib/whatsapp/connection'
import {
  getPhoneNumberState,
  getSubscribedApps,
  getWabaSetupStatus,
  registerPhoneNumber,
  subscribeWabaToApp,
} from '@/lib/whatsapp/meta-api'
import { explainMetaError } from '@/lib/whatsapp/meta-error-explain'
import { buildSetupChecks } from '@/lib/whatsapp/number-onboarding'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET  /api/whatsapp/health — why can't this workspace send or receive?
 *      Setup checks (business verification, account review, payment
 *      method, Meta's can-send roll-up), whether the WABA is subscribed
 *      to webhooks, the number's registration, and when the last
 *      customer message arrived.
 * POST /api/whatsapp/health — "Fix connection": re-subscribe the WABA
 *      to webhooks and, when the number has dropped off the Cloud API,
 *      register it again with the saved two-step PIN.
 */

async function lastInboundAt(
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase'],
  accountId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('messages')
      .select('created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
    return (data?.[0]?.created_at as string | undefined) ?? null
  } catch {
    return null
  }
}

function webhookSubscribed(
  apps: Awaited<ReturnType<typeof getSubscribedApps>>,
  onboardingMethod: string,
): boolean {
  // Manual connections use the client's own Meta app, so any subscribed
  // app counts; platform connections must list ours.
  const ours = process.env.NEXT_PUBLIC_META_APP_ID?.trim()
  if (onboardingMethod === 'manual' || !ours) return apps.length > 0
  return apps.some((a) => a.whatsapp_business_api_data?.id === ours)
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const conn = await loadAccountConnection(ctx.supabase, ctx.accountId, { requireWaba: true })
    const wabaId = conn.wabaId!

    const [status, apps, number, inbound] = await Promise.allSettled([
      getWabaSetupStatus({ wabaId, accessToken: conn.accessToken }),
      getSubscribedApps({ wabaId, accessToken: conn.accessToken }),
      getPhoneNumberState({ phoneNumberId: conn.phoneNumberId, accessToken: conn.accessToken }),
      lastInboundAt(ctx.supabase, ctx.accountId),
    ])

    return NextResponse.json({
      checks: status.status === 'fulfilled' ? buildSetupChecks(status.value, wabaId) : [],
      checks_error:
        status.status === 'rejected' ? explainMetaError(status.reason, 'waba_status', { wabaId }).summary : null,
      webhook_subscribed:
        apps.status === 'fulfilled' ? webhookSubscribed(apps.value, conn.onboardingMethod) : null,
      number:
        number.status === 'fulfilled'
          ? {
              status: number.value.status ?? null,
              platform_type: number.value.platform_type ?? null,
              code_verification_status: number.value.code_verification_status ?? null,
            }
          : null,
      last_inbound_at: inbound.status === 'fulfilled' ? inbound.value : null,
    })
  } catch (err) {
    return connectionErrorResponse(err) ?? toErrorResponse(err)
  }
}

type StepResult = { key: 'subscribe' | 'verify_subscription' | 'register'; state: 'ok' | 'fail' | 'skipped' | 'needs_pin'; error?: string }

export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`wa-repair:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const conn = await loadAccountConnection(ctx.supabase, ctx.accountId, { requireWaba: true })
    const wabaId = conn.wabaId!
    const metaCtx = { wabaId, phoneNumberId: conn.phoneNumberId }
    const steps: StepResult[] = []
    const now = new Date().toISOString()
    const update: Record<string, unknown> = { updated_at: now }

    // 1. Re-subscribe the WABA so its webhooks reach us again.
    try {
      await subscribeWabaToApp({ wabaId, accessToken: conn.accessToken })
      steps.push({ key: 'subscribe', state: 'ok' })
      update.subscribed_apps_at = now
    } catch (err) {
      steps.push({ key: 'subscribe', state: 'fail', error: explainMetaError(err, 'subscribe_waba', metaCtx).summary })
    }

    // 2. Confirm Meta now lists the subscription.
    try {
      const apps = await getSubscribedApps({ wabaId, accessToken: conn.accessToken })
      const ok = webhookSubscribed(apps, conn.onboardingMethod)
      steps.push(
        ok
          ? { key: 'verify_subscription', state: 'ok' }
          : { key: 'verify_subscription', state: 'fail', error: 'Meta does not list this app as subscribed yet.' },
      )
    } catch (err) {
      steps.push({ key: 'verify_subscription', state: 'fail', error: explainMetaError(err, 'subscribed_apps', metaCtx).summary })
    }

    // 3. Register the number again only if it has dropped off the Cloud
    //    API (Meta limits /register to a few calls a day per number).
    //    WhatsApp Business app numbers (coexistence) stay with the app.
    if (conn.onboardingMethod === 'coexistence') {
      steps.push({ key: 'register', state: 'skipped' })
    } else {
      try {
        const state = await getPhoneNumberState({ phoneNumberId: conn.phoneNumberId, accessToken: conn.accessToken })
        const healthy = state.platform_type === 'CLOUD_API' && (!state.status || state.status === 'CONNECTED')
        if (healthy) {
          steps.push({ key: 'register', state: 'skipped' })
        } else if (!conn.twoStepPin) {
          steps.push({
            key: 'register',
            state: 'needs_pin',
            error: 'The number needs registering again. Save it with its two-step PIN under “Connect with API credentials”.',
          })
        } else {
          await registerPhoneNumber({ phoneNumberId: conn.phoneNumberId, accessToken: conn.accessToken, pin: conn.twoStepPin })
          steps.push({ key: 'register', state: 'ok' })
          update.registered_at = now
          update.last_registration_error = null
        }
      } catch (err) {
        const summary = explainMetaError(err, 'register', metaCtx).summary
        steps.push({ key: 'register', state: 'fail', error: summary })
        update.last_registration_error = summary
      }
    }

    const ok = steps.every((s) => s.state === 'ok' || s.state === 'skipped')
    if (ok) {
      update.status = 'connected'
    }
    const { error: saveErr } = await ctx.supabase
      .from('whatsapp_config')
      .update(update)
      .eq('account_id', ctx.accountId)
    if (saveErr) throw saveErr

    return NextResponse.json({ ok, steps })
  } catch (err) {
    return connectionErrorResponse(err) ?? toErrorResponse(err)
  }
}
