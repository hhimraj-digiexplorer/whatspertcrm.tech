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
import { workspaceNumberLimit } from '@/lib/whatsapp/workspace-numbers'
import { isNumericMetaId, phoneNumberBelongsToWaba } from '@/lib/whatsapp/waba-pairing'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/numbers/{phoneNumberId}
 * Body: { action: 'request_code', method?: 'SMS' | 'VOICE', language? }
 *     | { action: 'verify', code }
 *     | { action: 'activate', mode?: 'add' | 'replace', pin?, label? }
 *     | { action: 'remove' }
 *     | { action: 'make_primary' }
 *     | { action: 'label', label }
 *
 * `activate` registers the number on the Cloud API (new two-step PIN, or
 * the one given), re-subscribes the WABA, then either adds it to the
 * workspace as an extra number (`add`, within the plan's number limit)
 * or makes it the workspace's only number (`replace`).
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
    const ACTIONS = ['request_code', 'verify', 'activate', 'remove', 'make_primary', 'label'] as const
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
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

    const db = supabaseAdmin()

    // Workspace-only changes: no Meta call needed.
    if (action === 'remove' || action === 'label') {
      const { data: extra } = await db
        .from('whatsapp_numbers')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('phone_number_id', id)
        .maybeSingle()
      if (!extra) {
        return NextResponse.json(
          { error: id === conn.phoneNumberId ? 'This is the primary number. Make another number primary first.' : 'This number is not in the workspace.' },
          { status: 404 },
        )
      }
      if (action === 'remove') {
        const { error } = await db.from('whatsapp_numbers').delete().eq('id', (extra as { id: string }).id)
        if (error) throw error
        return NextResponse.json({ success: true })
      }
      const label = cleanLabel(body.label)
      const { error } = await db
        .from('whatsapp_numbers')
        .update({ label, updated_at: new Date().toISOString() })
        .eq('id', (extra as { id: string }).id)
      if (error) throw error
      return NextResponse.json({ success: true, label })
    }

    if (action === 'make_primary') {
      if (id === conn.phoneNumberId) return NextResponse.json({ success: true })
      const { data: extra } = await db
        .from('whatsapp_numbers')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('phone_number_id', id)
        .eq('status', 'active')
        .maybeSingle()
      if (!extra) {
        return NextResponse.json({ error: 'Add this number to the workspace first.' }, { status: 404 })
      }
      const ex = extra as { id: string; two_step_pin: string | null; label: string | null; registered_at: string | null }
      const now = new Date().toISOString()
      // Swap: the old primary becomes an extra number, the chosen one
      // becomes the primary (keeping each number's PIN with it).
      const { error: swapIn } = await db
        .from('whatsapp_numbers')
        .update({
          phone_number_id: conn.phoneNumberId,
          two_step_pin: conn.twoStepPin ? encrypt(conn.twoStepPin) : null,
          display_phone_number: null,
          verified_name: null,
          label: null,
          updated_at: now,
        })
        .eq('id', ex.id)
      if (swapIn) throw swapIn
      const { error: primaryErr } = await db
        .from('whatsapp_config')
        .update({ phone_number_id: id, two_step_pin: ex.two_step_pin, updated_at: now })
        .eq('account_id', ctx.accountId)
      if (primaryErr) throw primaryErr
      return NextResponse.json({ success: true })
    }

    let wabaNumbers: Awaited<ReturnType<typeof listWabaPhoneNumbers>>
    try {
      const numbers = await listWabaPhoneNumbers({ wabaId, accessToken: conn.accessToken })
      wabaNumbers = numbers
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
    if (id === conn.phoneNumberId) {
      return NextResponse.json({ error: 'This number is already the primary number.' }, { status: 409 })
    }
    const mode = body.mode === 'add' ? 'add' : 'replace'
    const { data: claimed, error: claimedErr } = await db
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', id)
      .neq('account_id', ctx.accountId)
      .maybeSingle()
    if (claimedErr) throw claimedErr
    const { data: claimedExtra } = await db
      .from('whatsapp_numbers')
      .select('account_id')
      .eq('phone_number_id', id)
      .neq('account_id', ctx.accountId)
      .maybeSingle()
    if (mode === 'add') {
      const [limit, extras] = await Promise.all([
        workspaceNumberLimit(db, ctx.accountId),
        db.from('whatsapp_numbers').select('phone_number_id').eq('account_id', ctx.accountId),
      ])
      const extraIds = ((extras.data ?? []) as { phone_number_id: string }[]).map((r) => r.phone_number_id)
      if (!extraIds.includes(id) && 1 + extraIds.length >= limit) {
        return NextResponse.json(
          { error: `Your plan allows ${limit} WhatsApp number${limit === 1 ? '' : 's'}. Upgrade to Scale for up to 5.`, code: 'number_limit', limit },
          { status: 402 },
        )
      }
    }
    if (claimed || claimedExtra) {
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
    if (mode === 'add') {
      const info = wabaNumbers.find((n) => n.id === id)
      const { error: addErr } = await db.from('whatsapp_numbers').upsert(
        {
          account_id: ctx.accountId,
          phone_number_id: id,
          waba_id: wabaId,
          display_phone_number: info?.display_phone_number ?? null,
          verified_name: info?.verified_name ?? null,
          label: cleanLabel(body.label),
          two_step_pin: encrypt(pin),
          status: 'active',
          registered_at: now,
          created_by: ctx.userId,
          updated_at: now,
        },
        { onConflict: 'phone_number_id' },
      )
      if (addErr) throw addErr
      await db.from('whatsapp_config').update({ subscribed_apps_at: now }).eq('account_id', ctx.accountId)
      return NextResponse.json({ success: true, mode })
    }

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
    // The new primary must not also be listed as an extra number.
    await db.from('whatsapp_numbers').delete().eq('account_id', ctx.accountId).eq('phone_number_id', id)
    return NextResponse.json({ success: true, mode })
  } catch (err) {
    return connectionErrorResponse(err) ?? toErrorResponse(err)
  }
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/\s+/g, ' ').slice(0, 40)
  return v || null
}
