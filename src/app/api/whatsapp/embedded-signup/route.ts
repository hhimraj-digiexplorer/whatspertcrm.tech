import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  EmbeddedSignupConfigError,
  SignupAssetsError,
  exchangeCodeForToken,
  generateTwoStepPin,
  pickSignupPair,
  sharedWabaIds,
} from '@/lib/whatsapp/embedded-signup'
import {
  listWabaPhoneNumbers,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
} from '@/lib/whatsapp/meta-error-explain'
import { isNumericMetaId, phoneNumberBelongsToWaba } from '@/lib/whatsapp/waba-pairing'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/embedded-signup
 * Body: { code, phone_number_id, waba_id, coexistence? }        (popup flow)
 *    or: { code, redirect_uri, coexistence? }                     (mobile redirect flow)
 *
 * The redirect flow has no postMessage session info, so the WABA and
 * number are read from what the client shared with the token.
 *
 * Finishes Meta Embedded Signup for the caller's account:
 *   1. exchange the popup's code for a business integration token;
 *   2. check the number belongs to the WABA the client picked;
 *   3. subscribe the WABA to our app (so webhooks arrive);
 *   4. register the number with a generated two-step PIN — skipped for
 *      WhatsApp Business app numbers (coexistence), which stay
 *      registered to the app on the phone;
 *   5. save the connection, replacing any previous one.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`embedded-signup:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const code = typeof body?.code === 'string' ? body.code : ''
    let phoneNumberId = typeof body?.phone_number_id === 'string' ? body.phone_number_id : ''
    let wabaId = typeof body?.waba_id === 'string' ? body.waba_id : ''
    const coexistence = body?.coexistence === true
    const redirectUri = validRedirectUri(body?.redirect_uri, request)
    if (body?.redirect_uri !== undefined && !redirectUri) {
      return NextResponse.json({ error: 'Invalid signup return address.' }, { status: 400 })
    }

    let accessToken: string | null = null
    if (redirectUri && code && !phoneNumberId && !wabaId) {
      try {
        accessToken = await exchangeCodeForToken(code, redirectUri)
      } catch (err) {
        if (err instanceof EmbeddedSignupConfigError) throw err
        console.error('[embedded-signup] redirect code exchange failed:', err)
        return NextResponse.json(
          { error: 'Meta could not confirm the signup. Please run it again.' },
          { status: 400 },
        )
      }
      try {
        const wabas = await sharedWabaIds(accessToken)
        const candidates = await Promise.all(
          wabas.map(async (id) => ({
            wabaId: id,
            phoneIds: (await listWabaPhoneNumbers({ wabaId: id, accessToken: accessToken! })).map((n) => n.id),
          })),
        )
        const pair = pickSignupPair(candidates)
        wabaId = pair.wabaId
        phoneNumberId = pair.phoneNumberId
      } catch (err) {
        if (err instanceof EmbeddedSignupConfigError) throw err
        const message =
          err instanceof SignupAssetsError ? err.message : 'Could not read the WhatsApp account from Meta. Please try again.'
        if (!(err instanceof SignupAssetsError)) console.error('[embedded-signup] asset lookup failed:', err)
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }

    if (!code || !isNumericMetaId(phoneNumberId) || !isNumericMetaId(wabaId)) {
      return NextResponse.json(
        { error: 'Signup did not return a phone number. Please try again.' },
        { status: 400 },
      )
    }

    // One number belongs to one account on this platform.
    const { data: claimed, error: claimedErr } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', ctx.accountId)
      .maybeSingle()
    if (claimedErr) throw claimedErr
    if (claimed) {
      return NextResponse.json(
        { error: 'This WhatsApp number is already connected to another account.' },
        { status: 409 },
      )
    }

    if (!accessToken) {
      try {
        accessToken = await exchangeCodeForToken(code)
      } catch (err) {
        if (err instanceof EmbeddedSignupConfigError) throw err
        console.error('[embedded-signup] code exchange failed:', err)
        return NextResponse.json(
          { error: 'Meta could not confirm the signup. Please run it again.' },
          { status: 400 },
        )
      }
    }
    const token: string = accessToken!
    const metaCtx = { phoneNumberId, wabaId }
    const fail = (err: unknown, step: MetaConnectStep) => {
      const explained = explainMetaError(err, step, metaCtx)
      console.error(`[embedded-signup] ${step} failed:`, explained.metaMessage)
      return NextResponse.json(
        { error: explained.summary, meta: metaErrorPayload(explained) },
        { status: explained.httpStatus },
      )
    }

    try {
      const numbers = await listWabaPhoneNumbers({ wabaId, accessToken: token })
      if (!phoneNumberBelongsToWaba(numbers, phoneNumberId)) {
        return NextResponse.json(
          { error: 'The selected number is not part of the selected WhatsApp Business Account.' },
          { status: 400 },
        )
      }
    } catch (err) {
      return fail(err, 'waba_phone_numbers')
    }

    try {
      await subscribeWabaToApp({ wabaId, accessToken: token })
    } catch (err) {
      return fail(err, 'subscribe_waba')
    }

    let pin: string | null = null
    let registrationError: string | null = null
    if (!coexistence) {
      pin = generateTwoStepPin()
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken: token, pin })
      } catch (err) {
        // Keep the connection so the client can retry from the page.
        registrationError = explainMetaError(err, 'register', metaCtx).summary
        pin = null
      }
    }

    let phoneInfo: Awaited<ReturnType<typeof verifyPhoneNumber>> | null = null
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken: token })
    } catch {
      // Display details only — the number already checked out above.
    }

    const now = new Date().toISOString()
    const row = {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encrypt(token),
      two_step_pin: pin ? encrypt(pin) : null,
      onboarding_method: coexistence ? 'coexistence' : 'embedded',
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : now,
      registered_at: registrationError ? null : now,
      subscribed_apps_at: now,
      last_registration_error: registrationError,
      updated_at: now,
    }
    const { error: saveErr } = await ctx.supabase
      .from('whatsapp_config')
      .upsert(row, { onConflict: 'account_id' })
    if (saveErr) throw saveErr

    return NextResponse.json({
      success: !registrationError,
      registration_error: registrationError,
      phone_info: phoneInfo,
    })
  } catch (err) {
    if (err instanceof EmbeddedSignupConfigError) {
      return NextResponse.json({ error: 'One-click signup is not set up on this server yet.' }, { status: 503 })
    }
    return toErrorResponse(err)
  }
}

/**
 * The mobile flow's return address: must be this site's /whatsapp page
 * (the same address the browser sent to Meta's dialog).
 */
function validRedirectUri(value: unknown, request: Request): string | null {
  if (typeof value !== 'string' || value.length > 300) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const okProtocol = url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:')
  if (!okProtocol || url.pathname !== '/whatsapp' || url.search || url.hash) return null
  if (host && url.host !== host) return null
  return url.toString()
}
