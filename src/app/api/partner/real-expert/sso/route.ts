import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { EMBED_COOKIE, EMBED_COOKIE_OPTIONS } from '@/lib/supabase/embed'
import {
  loadEntitlement,
  mapRole,
  PartnerConfigError,
  partnerSecret,
  safeLandingPath,
  verifySsoToken,
} from '@/lib/partner/real-expert'
import { findPartnerIntegration, siteOrigin } from '@/lib/partner/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/partner/real-expert/sso?t=<token>
 *
 * Single sign-on from Real Expert CRM. Real Expert mints a token (valid
 * a few minutes) for the signed-in user and opens this URL, in its
 * iframe or a new tab. We check the add-on is paid for, make sure the
 * user is a member of the linked Whatspert account (creating them on
 * first visit), start a session and land them on `path`.
 *
 * An email that already belongs to another Whatspert account is never
 * moved or signed in here.
 */
function page(title: string, message: string, status: number) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f8fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.card{max-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;box-shadow:0 1px 3px rgb(16 24 40/.06)}
h1{font-size:18px;margin:0 0 8px}p{color:#475569;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  let secret: string
  try {
    secret = partnerSecret()
  } catch (err) {
    if (err instanceof PartnerConfigError) return page('Not available', 'WhatsApp sign-in is not set up yet.', 503)
    throw err
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limit = checkRateLimit(`partner-sso:${ip}`, RATE_LIMITS.adminAction)
  if (!limit.success) return rateLimitResponse(limit)

  const token = new URL(request.url).searchParams.get('t') ?? ''
  const payload = verifySsoToken(secret, token)
  if (!payload) return page('Link expired', 'Please open WhatsApp again from Real Expert CRM.', 401)

  const db = supabaseAdmin()
  const integration = await findPartnerIntegration(db, payload.ref)
  if (!integration) return page('Not connected', 'This Real Expert workspace is not connected to WhatsApp yet.', 404)

  const entitlement = await loadEntitlement(db, integration.account_id, integration.partner_crm_active)
  if (!entitlement.entitled) {
    return page(
      'WhatsApp add-on locked',
      entitlement.reason === 'crm_unpaid'
        ? 'Your Real Expert CRM subscription is not active. Renew it to use WhatsApp.'
        : 'Your WhatsApp plan is not active. Choose a WhatsApp plan in Real Expert to unlock it.',
      403,
    )
  }

  const email = payload.email.trim().toLowerCase()
  const { data: profile } = await db
    .from('profiles')
    .select('user_id, account_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()

  if (profile && profile.account_id !== integration.account_id) {
    return page(
      'Email already in use',
      `${email} already has a separate Whatspert account. Ask your admin to use a different email for this Real Expert user.`,
      409,
    )
  }
  if (!profile) {
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: payload.name ?? '' },
    })
    if (error || !created.user) {
      console.error('[partner/sso] createUser failed:', error)
      return page('Something went wrong', 'Could not open WhatsApp. Please try again.', 500)
    }
    const { error: joinErr } = await db.rpc('partner_join_account', {
      p_user_id: created.user.id,
      p_account_id: integration.account_id,
      p_role: mapRole(payload.role),
    })
    if (joinErr) {
      console.error('[partner/sso] join failed:', joinErr)
      return page('Something went wrong', 'Could not add you to the WhatsApp workspace.', 500)
    }
  }

  // Start a session without a password: a one-time magic-link token,
  // verified right here so the browser never sees an email.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    console.error('[partner/sso] generateLink failed:', linkErr)
    return page('Something went wrong', 'Could not sign you in. Please try again.', 500)
  }

  const cookieStore = await cookies()
  const embed = payload.embed === true
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: embed ? EMBED_COOKIE_OPTIONS : undefined,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  })
  const { error: otpErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (otpErr) {
    console.error('[partner/sso] verifyOtp failed:', otpErr)
    return page('Something went wrong', 'Could not sign you in. Please try again.', 500)
  }

  if (embed) cookieStore.set(EMBED_COOKIE, '1', { ...EMBED_COOKIE_OPTIONS, httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
  else cookieStore.delete(EMBED_COOKIE)

  return NextResponse.redirect(`${siteOrigin(request)}${safeLandingPath(payload.path)}`, 303)
}
