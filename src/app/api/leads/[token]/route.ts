import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { hashLeadToken, LEAD_HOOK_COLUMNS, LEAD_TOKEN_RE, toLeadHook } from '@/lib/leads/hooks'
import { intakeLead, LeadIntakeError } from '@/lib/leads/intake'
import { parseLeadBody, readLeadRequest } from '@/lib/leads/parse'
import { SendMessageError } from '@/lib/whatsapp/send-message'

/**
 * POST /api/leads/{secret} — a lead from any source: another CRM's
 * webhook, a website form, Meta lead ads through Zapier / Make / Pabbly,
 * a landing-page builder. The secret in the URL identifies the lead
 * source (Settings → Projects → Lead sources); there is nothing else to
 * configure on the sender's side.
 *
 * Body: JSON, form-encoded or multipart. Phone is required; name, email,
 * project (code / tag / name), campaign, ad, form, page URL and UTM
 * fields are read when present (see lib/leads/parse). The lead lands on
 * its project, gets that project's welcome and starts its automations.
 *
 * GET /api/leads/{secret} answers { ok: true } so tools can test the URL.
 */

const MAX_BODY = 64 * 1024

type Params = { params: Promise<{ token: string }> }

async function findHook(token: string) {
  if (!LEAD_TOKEN_RE.test(token)) return null
  const { data } = await supabaseAdmin()
    .from('lead_webhooks')
    .select(LEAD_HOOK_COLUMNS)
    .eq('token_hash', hashLeadToken(token))
    .maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params
  const row = await findHook(token)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, lead_source: row.name, active: row.is_active !== false, method: 'POST' })
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params
  const limit = checkRateLimit(`lead-hook:${token.slice(0, 16)}`, RATE_LIMITS.publicApi)
  if (!limit.success) return rateLimitResponse(limit)

  const row = await findHook(token)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.is_active === false) {
    return NextResponse.json({ error: 'This lead source is switched off in Whatspert CRM.' }, { status: 403 })
  }
  const hook = toLeadHook(row)
  const db = supabaseAdmin()

  let body: unknown = null
  const contentType = request.headers.get('content-type')
  try {
    if ((contentType ?? '').toLowerCase().includes('multipart/form-data')) {
      const form = await request.formData()
      body = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'))
    } else {
      const raw = await request.text()
      if (raw.length > MAX_BODY) return NextResponse.json({ error: 'Lead too large.' }, { status: 413 })
      body = readLeadRequest(raw, contentType)
    }
  } catch {
    body = null
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Send the lead as JSON or a form post.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  try {
    const result = await intakeLead(db, hook, parseLeadBody(body))
    await db
      .from('lead_webhooks')
      .update({
        leads_received: (Number(row.leads_received) || 0) + 1,
        last_received_at: now,
        last_error: result.message_error ? `Welcome not sent: ${result.message_error.error}`.slice(0, 300) : null,
        updated_at: now,
      })
      .eq('id', hook.id)
    return NextResponse.json(result)
  } catch (err) {
    const known = err instanceof LeadIntakeError || err instanceof SendMessageError
    const message = known ? (err as Error).message : 'Something went wrong.'
    const status = known ? (err as LeadIntakeError | SendMessageError).status : 500
    if (!known) console.error('[lead-hook] failed:', err)
    await db
      .from('lead_webhooks')
      .update({ last_error: message.slice(0, 300), updated_at: now })
      .eq('id', hook.id)
      .then(
        () => undefined,
        () => undefined,
      )
    return NextResponse.json(
      { error: message, ...(known ? { code: (err as LeadIntakeError | SendMessageError).code } : {}) },
      { status },
    )
  }
}
