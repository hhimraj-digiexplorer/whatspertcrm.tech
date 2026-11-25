import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import {
  chooseWelcome,
  cleanTagName,
  leadTagNames,
  matchProject,
  parseOptions,
  slugify,
  toInternationalDigits,
} from '@/lib/integrations/real-expert/config'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { assignTagsToGroup, PROJECT_TAG_GROUP } from '@/lib/tags/groups'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
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
 * Body: the lead, flat (Real Expert's "Send new leads to"):
 *   { lead_id, name, phone, email?, company?, source?, project?, city?,
 *     project_id?, project_code?, project_tag?, enquiry_id?,
 *     is_repeat_enquiry?, created_at?, tags?: string[],
 *     template?: { name, language?, variables?: string[] } }
 *
 * Projects (channel partners): the lead's project is matched on its
 * code / tag / id / name against Integrations → Real Expert → Projects.
 * The project's tag is added and its own welcome sent (or none); the
 * account default welcome only when allowed (fallback_welcome). A push
 * for a project the contact already has (same tag) is not greeted
 * again. A second project for the same phone adds that project's tag,
 * which starts its automations; the first project's runs are untouched.
 *
 * The contact gets the tag mapped to its `source` (integration settings)
 * plus any `tags`; each newly added tag fires Tag Added, and a contact
 * this lead created fires New Contact Created.
 * Also accepted: `{ lead: {...} }`, `{ event: "lead.created", data: {...} }`
 * and first_name / last_name instead of name.
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
  const { data: entitled } = await db.rpc('crm_integration_entitled', { p_integration_id: integration.id })
  if (entitled !== true) {
    return NextResponse.json(
      { error: 'The WhatsApp add-on needs both a paid Real Expert plan and a paid WhatsApp plan.', code: 'locked' },
      { status: 403 },
    )
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

    // Where the enquiry came from, for the agent reading the chat.
    const repeat = lead.is_repeat_enquiry === true || lead.is_repeat_enquiry === 'true'
    const details = [
      ['Source', str(lead.source, 60)],
      ['Project', str(lead.project, 120)],
      ['Project code', str(lead.project_code, 60)],
      ['Enquiry', str(lead.enquiry_id, 100)],
      ['City', str(lead.city, 80)],
      ['Repeat enquiry', repeat ? 'yes' : null],
    ].filter(([, v]) => v)
    if (details.length > 0) {
      try {
        const userId = await resolveAuditUserId(db, accountId)
        await db.from('contact_notes').insert({
          contact_id: resolved.contactId,
          account_id: accountId,
          user_id: userId,
          note_text: `Real Expert lead${leadId ? ` #${leadId}` : ''} · ${details.map(([k, v]) => `${k}: ${v}`).join(' · ')}`,
        })
      } catch (err) {
        console.warn('[crm-inbound] could not save lead details:', err)
      }
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

    // Which project this lead is for, and its tag(s).
    const project = matchProject(options.projects, lead)
    const projectTagNames = [project?.setting.tag, lead.project_tag].filter(Boolean)
    // Already enquired about this project? (contact had its tag before
    // this push) — then don't greet it again.
    const alreadyEnquired =
      !resolved.contactCreated && (await contactHasAnyTag(db, accountId, resolved.contactId, projectTagNames))

    // 1. Greeting. A failed greeting must not stop the tags and triggers
    //    below — they are what start the workspace's own flows.
    const tpl = (lead.template && typeof lead.template === 'object' ? lead.template : {}) as Record<string, unknown>
    const payloadTemplateName = str(tpl.name, 512)
    const { data: optRow } = await db
      .from('contacts')
      .select('opted_out_at')
      .eq('id', resolved.contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    const welcome = chooseWelcome({
      optedOut: !!(optRow as { opted_out_at?: string | null } | null)?.opted_out_at,
      options,
      payloadTemplate: payloadTemplateName ? { name: payloadTemplateName, language: str(tpl.language, 20) } : null,
      project,
      defaultTemplate: {
        name: (integration.welcome_template_name as string | null) ?? null,
        language: (integration.welcome_template_language as string | null) ?? null,
      },
      alreadyEnquired,
    })
    let sent: { messageId: string; whatsappMessageId: string } | null = null
    let sendError: SendMessageError | null = null
    if (welcome.kind === 'template') {
      try {
        const params = await templateParams(db, accountId, welcome.template, tpl.variables, name || null)
        sent = await sendMessageToConversation(db, accountId, {
          conversationId: resolved.conversationId,
          messageType: 'template',
          templateName: welcome.template,
          templateLanguage: welcome.language,
          templateParams: params,
        })
      } catch (err) {
        if (!(err instanceof SendMessageError)) throw err
        sendError = err
        console.warn('[crm-inbound] welcome template not sent:', err.code, err.message)
      }
    }

    const context = { conversation_id: resolved.conversationId, source: 'real_expert' }

    // 2. New Contact Created, for a contact this lead just created.
    if (resolved.contactCreated) {
      await runAutomationsForTrigger({
        accountId,
        triggerType: 'new_contact_created',
        contactId: resolved.contactId,
        context,
      })
    }

    // 3. Tags: the one mapped to this lead source in the integration
    //    settings, plus any the payload names. Each new tag fires Tag Added.
    const tagNames = leadTagNames(options.source_tags, source, lead.tags, projectTagNames)
    const tagsAdded: string[] = []
    if (tagNames.length > 0) {
      try {
        const auditUserId = await resolveAuditUserId(db, accountId)
        const { tagIdByKey } = await resolveImportTagIds(db, {
          accountId,
          userId: auditUserId,
          tagNames,
          canCreateTags: true,
        })
        // Project tags sit in the "Project" group, before Tag Added
        // fires, so a group condition in that automation already sees it.
        if (projectTagNames.length > 0) {
          await assignTagsToGroup(db, accountId, projectTagNames as string[], PROJECT_TAG_GROUP).catch((err) =>
            console.error('[crm-inbound] could not group project tags:', err),
          )
        }
        for (const tagName of tagNames) {
          const tagId = tagIdByKey.get(tagName.toLowerCase())
          if (!tagId) continue
          const r = await addContactTagAndDispatch({
            db,
            accountId,
            contactId: resolved.contactId,
            tagId,
            context,
          })
          if (r.added) tagsAdded.push(tagName)
        }
      } catch (err) {
        console.error('[crm-inbound] could not tag the lead:', err)
      }
    }

    return NextResponse.json({
      contact_id: resolved.contactId,
      conversation_id: resolved.conversationId,
      contact_created: resolved.contactCreated,
      tags_added: tagsAdded,
      project: project ? project.setting.name : null,
      welcome: welcome.kind === 'template' ? { template: welcome.template, reason: welcome.reason } : { skipped: welcome.reason },
      message_sent: !!sent,
      ...(sent ? { message_id: sent.messageId, whatsapp_message_id: sent.whatsappMessageId } : {}),
      ...(sendError ? { message_error: { code: sendError.code, error: sendError.message } } : {}),
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

/** Whether the contact already carries any of these tags (by name). */
async function contactHasAnyTag(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  names: unknown[],
): Promise<boolean> {
  const wanted = names.map((n) => cleanTagName(n)?.toLowerCase()).filter((n): n is string => !!n)
  if (wanted.length === 0) return false
  const { data } = await db
    .from('contact_tags')
    .select('tags!inner(name, account_id)')
    .eq('contact_id', contactId)
    .eq('tags.account_id', accountId)
  return (data ?? []).some((row) => {
    const t = (row as { tags?: { name?: string } | { name?: string }[] }).tags
    const tagName = Array.isArray(t) ? t[0]?.name : t?.name
    return !!tagName && wanted.includes(tagName.toLowerCase())
  })
}
