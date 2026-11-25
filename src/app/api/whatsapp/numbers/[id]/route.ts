import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import { connectionErrorResponse, loadAccountConnection } from '@/lib/whatsapp/connection'
import { generateTwoStepPin } from '@/lib/whatsapp/embedded-signup'
import {
  listWabaPhoneNumbers,
  registerPhoneNumber,
  requestVerificationCode,
  subscribeWabaToApp,
  verifyPhoneCode,
} from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
} from '@/lib/whatsapp/meta-error-explain'
import { parseVerificationCode } from '@/lib/whatsapp/number-onboarding'
import { isNumericMetaId, phoneNumberBelongsToWaba } from '@/lib/whatsapp/waba-pairing'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/numbers/{phoneNumberId}
 * Body: { action: 'request_code', method?: 'SMS' | 'VOICE', language? }
 *     | { action: 'verify', code }
 *     | { action: 'activate' }
 *
 * The steps after adding a number by SMS code. `activate` registers the
 * number on the Cloud API with a new two-step PIN, re-subscribes the
 * WABA and makes it the number this workspace sends from (one number per
 * workspace today, so it replaces the current one).
 *
 * Every action first checks the number belongs to the account's own
 * WhatsApp Business Account.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!isNumericMetaId(id)) {
      return NextResponse.json({ error: 'Invalid phone number id.' }, { status: 400 })
    }
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`wa-number-step:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
    const action = body.action
    if (action !== 'request_code' && action !== 'verify' && action !== 'activate') {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }

    const conn = await loadAccountConnection(ctx.supabase, ctx.accountId, { requireWaba: true })
    const wabaId = conn.wabaId!
    const metaCtx = { phoneNumberId: id, wabaId }
    const fail = (err: unknown, step: MetaConnectStep) => {
      const explained = explainMetaError(err, step, metaCtx)
      console.error(`[numbers/${action}] ${step} failed:`, explained.metaMessage)
      return NextResponse.json(
        { error: explained.summary, meta: metaErrorPayload(explained) },
        { status: explained.httpStatus },
      )
    }

    try {
      const numbers = await listWabaPhoneNumbers({ wabaId, accessToken: conn.accessToken })
      if (!phoneNumberBelongsToWaba(numbers, id)) {
        return NextResponse.json(
          { error: 'This number is not part of your WhatsApp Business Account.' },
          { status: 404 },
        )
      }
    } catch (err) {
      return fail(err, 'waba_phone_numbers')
    }

    if (action === 'request_code') {
      const method = body.method === 'VOICE' ? 'VOICE' : 'SMS'
      const language = typeof body.language === 'string' && /^[a-z]{2}(_[A-Z]{2})?$/.test(body.language)
        ? body.language
        : 'en'
      try {
        await requestVerificationCode({ phoneNumberId: id, accessToken: conn.accessToken, method, language })
        return NextResponse.json({ success: true, method })
      } catch (err) {
        return fail(err, 'request_code')
      }
    }

    if (action === 'verify') {
      const code = parseVerificationCode(body.code)
      if (!code) {
        return NextResponse.json({ error: 'Enter the 6-digit code.', field: 'code' }, { status: 400 })
      }
      try {
        await verifyPhoneCode({ phoneNumberId: id, accessToken: conn.accessToken, code })
        return NextResponse.json({ success: true })
      } catch (err) {
        return fail(err, 'verify_code')
      }
    }

    // activate
    const { data: claimed, error: claimedErr } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', id)
      .neq('account_id', ctx.accountId)
      .maybeSingle()
    if (claimedErr) throw claimedErr
    if (claimed) {
      return NextResponse.json(
        { error: 'This WhatsApp number is already connected to another account.' },
        { status: 409 },
      )
    }

    // A number that already has two-step verification needs its PIN; a
    // freshly verified number gets a new one (register sets it).
    const givenPin = parseVerificationCode(body.pin)
    if (body.pin !== undefined && body.pin !== '' && !givenPin) {
      return NextResponse.json({ error: 'The two-step PIN is 6 digits.', field: 'pin' }, { status: 400 })
    }
    const pin = givenPin ?? generateTwoStepPin()
    try {
      await registerPhoneNumber({ phoneNumberId: id, accessToken: conn.accessToken, pin })
    } catch (err) {
      return fail(err, 'register')
    }
    try {
      await subscribeWabaToApp({ wabaId, accessToken: conn.accessToken })
    } catch (err) {
      return fail(err, 'subscribe_waba')
    }

    const now = new Date().toISOString()
    const { error: saveErr } = await ctx.supabase
      .from('whatsapp_config')
      .update({
        phone_number_id: id,
        two_step_pin: encrypt(pin),
        status: 'connected',
        connected_at: now,
        registered_at: now,
        subscribed_apps_at: now,
        last_registration_error: null,
        updated_at: now,
      })
      .eq('account_id', ctx.accountId)
    if (saveErr) throw saveErr
    return NextResponse.json({ success: true })
  } catch (err) {
    return connectionErrorResponse(err) ?? toErrorResponse(err)
  }
}
