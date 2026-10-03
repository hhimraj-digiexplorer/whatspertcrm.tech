import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { parseOptions, slugify, toInternationalDigits } from '@/lib/integrations/real-expert/config'
import { countPlaceholders, signatureMatches, tokensMatch } from '@/lib/integrations/real-expert/settings'

/**
 * POST /api/integrations/real-expert/inbound/{integrationId}
 *
 * Real Expert calls this when a lead is created there. We add the lead
 * as a WhatsApp contact, link it to the Real Expert lead (so it is not
 * pushed back as a new lead), and greet it with the account's chosen
 * approved template.
 *
 * Auth, any one of:
 *   - `X-Webhook-Signature`: hex HMAC-SHA256 of the raw body, keyed with
 *     the inbound token (Real Expert webhooks: paste the token as the
 *     webhook's Secret);
 *   - `Authorization: Bearer <token>` or `X-Whatspert-Token: <token>`.
 *
 * Body: a Real Expert webhook `{ event: "lead.created", data: {...} }`,
 * or a lead directly (flat or under `lead`):
 *   { lead_id, first_name, last_name | name, phone, email?,
 *     template?: { name, language?, variables?: string[] } }
 */
type Params = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const limit = checkRateLimit(`crm-inbound:${id}`, RATE_LIMITS.publicApi)
  if (!limit.success) return rateLimitResponse(limit)

  const db = supabaseAdmin()
  const { data: integration } = await db
    .from('crm_integrations')
    .select('id, account_id, is_active, inbound_enabled, inbound_token, welcome_template_name, welcome_template_language, options')
    .eq('id', id)
    .maybeSingle()
  if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rawBody = await request.text().catch(() => '')
  let expected = ''
  try {
    expected = decrypt(integration.inbound_token)
  } catch {
    // unreadable token — nothing can match
  }
  const auth = request.headers.get('authorization') ?? ''
  const supplied = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : (request.headers.get('x-whatspert-token') ?? '').trim()
  const signature = (request.headers.get('x-webhook-signature') ?? '').trim()
  const authorized =
    !!expected &&
    ((supplied && tokensMatch(supplied, expected)) || (signature && signatureMatches(rawBody, expected, signature)))
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!integration.is_active || !integration.inbound_enabled) {
    return NextResponse.json({ error: 'Receiving leads is switched off in Whatspert CRM.' }, { status: 403 })
  }

  let raw: Record<string, unknown> | null = null
  try {
    raw = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    raw = null
  }
  if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Send the lead as JSON.' }, { status: 400 })
  // Real Expert webhooks carry every subscribed event; only new leads matter.
  if (typeof raw.event === 'string' && raw.event !== 'lead.created') {
    return NextResponse.json({ ignored: true, reason: 'event' })
  }
  const nested = [raw.data, raw.lead].find((v) => v && typeof v === 'object')
  const lead = (nested ?? raw) as Record<string, unknown>

  const options = parseOptions(integration.options).options
  const digits = toInternationalDigits(lead.phone ?? lead.mobile ?? lead.whatsapp, options.default_country_code)
  if (!digits) {
    return NextResponse.json({ error: 'The lead has no valid phone number.' }, { status: 400 })
  }
  const leadId = str(lead.lead_id ?? lead.id, 100)

  // Leads Whatspert itself created in Real Expert come back here as
  // lead.created; they already have a WhatsApp chat — don't greet again.
  const source = str(lead.source, 100)
  if (source && slugify(source) === slugify(options.lead_source)) {
    return NextResponse.json({ ignored: true, reason: 'own_lead' })
  }
  if (leadId) {
    const { data: ownLink } = await db
      .from('crm_contact_links')
      .select('contact_id')
      .eq('integration_id', integration.id)
      .eq('external_id', leadId)
      .eq('origin', 'whatspert')
      .limit(1)
      .maybeSingle()
    if (ownLink) return NextResponse.json({ ignored: true, reason: 'own_lead' })
  }
  const name = str(lead.name, 120) ?? [str(lead.first_name, 60), str(lead.last_name, 60)].filter(Boolean).join(' ') ?? null
  const accountId = integration.account_id as string

  try {
    const resolved = await resolveConversationByPhone(db, accountId, `+${digits}`, name || null)

    const extra: Record<string, string> = {}
    const email = str(lead.email, 200)
    const company = str(lead.company, 200)
    if (email) extra.email = email
    if (company) extra.company = company
    if (Object.keys(extra).length > 0) {
      await db.from('contacts').update(extra).eq('id', resolved.contactId).eq('account_id', accountId)
    }

    // Tie the contact to the Real Expert lead and drop the "create lead"
    // job its insert queued, so the lead is not echoed back.
    if (leadId) {
      await db.from('crm_contact_links').upsert(
        {
          integration_id: integration.id,
          contact_id: resolved.contactId,
          account_id: accountId,
          external_id: leadId,
          origin: 'real_expert',
        },
        { onConflict: 'integration_id,contact_id' },
      )
    }
    await db
      .from('crm_sync_queue')
      .delete()
      .eq('integration_id', integration.id)
      .eq('kind', 'lead')
      .eq('entity_id', resolved.contactId)
      .eq('status', 'pending')

    const tpl = (lead.template && typeof lead.template === 'object' ? lead.template : {}) as Record<string, unknown>
    const templateName = str(tpl.name, 512) ?? integration.welcome_template_name
    if (!templateName) {
      return NextResponse.json({
        contact_id: resolved.contactId,
        conversation_id: resolved.conversationId,
        message_sent: false,
      })
    }
    const templateLanguage = str(tpl.language, 20) ?? integration.welcome_template_language ?? null
    const params = await templateParams(db, accountId, templateName, tpl.variables, name || null)

    const sent = await sendMessageToConversation(db, accountId, {
      conversationId: resolved.conversationId,
      messageType: 'template',
      templateName,
      templateLanguage,
      templateParams: params,
    })

    return NextResponse.json({
      contact_id: resolved.contactId,
      conversation_id: resolved.conversationId,
      message_sent: true,
      message_id: sent.messageId,
      whatsapp_message_id: sent.whatsappMessageId,
    })
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[crm-inbound] failed:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

/**
 * Variables for the welcome template: whatever Real Expert sent, else
 * the lead's first name for {{1}} (and its full name for any others),
 * matching the number of placeholders in the approved body.
 */
async function templateParams(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  templateName: string,
  supplied: unknown,
  name: string | null,
): Promise<string[]> {
  if (Array.isArray(supplied)) return supplied.map((v) => String(v ?? ''))
  const { data } = await db
    .from('message_templates')
    .select('body_text')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .limit(1)
    .maybeSingle()
  const n = countPlaceholders((data as { body_text?: string } | null)?.body_text)
  if (n === 0) return []
  const first = name?.split(/\s+/)[0] || 'there'
  return Array.from({ length: n }, (_, i) => (i === 0 ? first : name || first))
}
