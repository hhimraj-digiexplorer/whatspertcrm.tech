/**
 * Lead intake (migration 055): one lead from any source — a CRM's
 * webhook, a website form, Meta lead ads via Zapier / Make / Pabbly — to
 * a WhatsApp contact on the right project:
 *
 *   1. find or create the contact + conversation (by phone);
 *   2. save where the lead came from (contact.lead_meta + a note);
 *   3. pick the project (explicit value → ad id → keyword in campaign /
 *      ad / form / page / UTM → the lead source's default project);
 *   4. greet: the project's welcome, else the source's default welcome —
 *      never another project's, never twice for the same project, never
 *      to a contact who sent STOP;
 *   5. tags: the source's tags, the lead's own tags, the project tag —
 *      each new one fires Tag Added, so the project's automations start.
 *
 * A failed greeting never blocks the tags (they start the workspace's
 * own follow-ups). No CRM integration is needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { toInternationalDigits } from '@/lib/integrations/real-expert/config'
import { resolveProject, type Project, type ProjectMatch } from '@/lib/projects/match'
import { assignContactProject, loadContactProjects, loadProjects } from '@/lib/projects/store'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { defaultTemplateParams } from '@/lib/whatsapp/template-params'
import { leadSourceTexts, type LeadInput } from './parse'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface LeadHook {
  id: string
  account_id: string
  name: string
  default_project_id: string | null
  tags: string[]
  send_welcome: boolean
  welcome_template: string | null
  welcome_language: string | null
  default_country_code: string
}

export type WelcomeDecision =
  | { kind: 'template'; template: string; language: string | null; reason: 'payload' | 'project' | 'source_default' }
  | {
      kind: 'none'
      reason: 'opted_out' | 'already_enquired' | 'project_none' | 'welcome_off' | 'no_template' | 'ambiguous_project'
    }

/** Which welcome this lead gets (pure). */
export function chooseLeadWelcome(args: {
  hook: Pick<LeadHook, 'send_welcome' | 'welcome_template' | 'welcome_language'>
  project: Project | null
  ambiguous: boolean
  payloadTemplate: { name: string; language: string | null } | null
  optedOut: boolean
  alreadyEnquired: boolean
}): WelcomeDecision {
  const { hook, project } = args
  if (args.optedOut) return { kind: 'none', reason: 'opted_out' }
  if (args.payloadTemplate) {
    return { kind: 'template', template: args.payloadTemplate.name, language: args.payloadTemplate.language, reason: 'payload' }
  }
  if (!hook.send_welcome) return { kind: 'none', reason: 'welcome_off' }
  if (args.alreadyEnquired) return { kind: 'none', reason: 'already_enquired' }
  if (project?.welcome_mode === 'none') return { kind: 'none', reason: 'project_none' }
  if (project?.welcome_mode === 'template' && project.welcome_template) {
    return { kind: 'template', template: project.welcome_template, language: project.welcome_language, reason: 'project' }
  }
  // A lead that named two projects must not get a generic greeting that
  // could read as either — a person or the picker sorts it out.
  if (args.ambiguous) return { kind: 'none', reason: 'ambiguous_project' }
  if (hook.welcome_template) {
    return { kind: 'template', template: hook.welcome_template, language: hook.welcome_language, reason: 'source_default' }
  }
  return { kind: 'none', reason: 'no_template' }
}

/** The project for a lead (pure): the lead's own signals, else the source's default. */
export function leadProject(projects: Project[], lead: LeadInput, defaultProjectId: string | null): ProjectMatch {
  const m = resolveProject(projects, {
    values: lead.projectValues,
    adId: lead.adId,
    sourceTexts: leadSourceTexts(lead),
  })
  if (m.project || m.ambiguous) return m
  const def = defaultProjectId ? projects.find((p) => p.id === defaultProjectId && p.is_active) : null
  return def ? { project: def, via: 'default', ambiguous: false } : m
}

export class LeadIntakeError extends Error {
  constructor(
    readonly code: 'no_phone' | 'whatsapp_not_configured' | 'bad_request',
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'LeadIntakeError'
  }
}

export interface LeadIntakeResult {
  contact_id: string
  conversation_id: string
  contact_created: boolean
  project: string | null
  project_via: ProjectMatch['via']
  project_ambiguous: boolean
  tags_added: string[]
  welcome: { template: string; reason: string } | { skipped: string }
  message_sent: boolean
  message_error?: { code: string; error: string }
}

export async function intakeLead(db: Db, hook: LeadHook, lead: LeadInput): Promise<LeadIntakeResult> {
  const accountId = hook.account_id
  const digits = toInternationalDigits(lead.phone, hook.default_country_code || '91')
  if (!digits) throw new LeadIntakeError('no_phone', 'The lead has no valid phone number.')

  let resolved: Awaited<ReturnType<typeof resolveConversationByPhone>>
  try {
    resolved = await resolveConversationByPhone(db, accountId, `+${digits}`, lead.name)
  } catch (err) {
    if (err instanceof SendMessageError && err.code === 'whatsapp_not_configured') {
      throw new LeadIntakeError('whatsapp_not_configured', err.message, 409)
    }
    throw err
  }
  const contactId = resolved.contactId
  const userId = await resolveAuditUserId(db, accountId)

  // 1. Contact details + where the lead came from.
  const update: Record<string, unknown> = {
    lead_meta: {
      channel: 'lead_webhook',
      lead_source: hook.name,
      source: lead.source,
      campaign: lead.campaign,
      adset: lead.adset,
      ad_name: lead.adName,
      ad_id: lead.adId,
      form_name: lead.formName,
      page_url: lead.pageUrl,
      utm: Object.keys(lead.utm).length > 0 ? lead.utm : null,
      received_at: new Date().toISOString(),
    },
  }
  if (lead.email) update.email = lead.email
  await db.from('contacts').update(update).eq('id', contactId).eq('account_id', accountId)

  // 2. Project.
  const projects = await loadProjects(db, accountId)
  const match = leadProject(projects, lead, hook.default_project_id)
  const before = await loadContactProjects(db, accountId, contactId, projects)
  const alreadyEnquired =
    !resolved.contactCreated &&
    !!match.project &&
    before.tagNames.some((t) => t.toLowerCase() === match.project!.tag.toLowerCase())

  // 3. Note for the agent.
  const details: [string, string | null][] = [
    ['Lead source', hook.name],
    ['Source', lead.source],
    ['Project', match.project?.name ?? (match.ambiguous ? 'unclear (matches more than one)' : lead.projectValues[0] ?? null)],
    ['Campaign', lead.campaign],
    ['Ad set', lead.adset],
    ['Ad', lead.adName],
    ['Form', lead.formName],
    ['Page', lead.pageUrl],
    ['City', lead.city],
    ['Lead id', lead.externalId],
    ['Message', lead.message],
    ...Object.entries(lead.utm),
    ...Object.entries(lead.extra),
  ]
  const noteText = details
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
    .slice(0, 4000)
  if (noteText) {
    await db
      .from('contact_notes')
      .insert({ contact_id: contactId, account_id: accountId, user_id: userId, note_text: `New lead · ${noteText}` })
      .then(
        () => undefined,
        (err: unknown) => console.warn('[lead-intake] could not save the note:', err),
      )
  }

  // 4. Welcome.
  const { data: optRow } = await db
    .from('contacts')
    .select('opted_out_at')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  const welcome = chooseLeadWelcome({
    hook,
    project: match.project,
    ambiguous: match.ambiguous,
    payloadTemplate: lead.template ? { name: lead.template.name, language: lead.template.language } : null,
    optedOut: !!(optRow as { opted_out_at?: string | null } | null)?.opted_out_at,
    alreadyEnquired,
  })
  let sent: { messageId: string; whatsappMessageId: string } | null = null
  let sendError: SendMessageError | null = null
  if (welcome.kind === 'template') {
    try {
      const params = await defaultTemplateParams(db, accountId, welcome.template, lead.template?.variables ?? null, lead.name)
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
      console.warn('[lead-intake] welcome not sent:', err.code, err.message)
    }
  }

  // 5. Triggers and tags.
  const context = { conversation_id: resolved.conversationId, source: 'lead_webhook' }
  if (resolved.contactCreated) {
    await runAutomationsForTrigger({ accountId, triggerType: 'new_contact_created', contactId, context })
  }
  const tagsAdded: string[] = []
  const plainTags = [...new Set([...hook.tags, ...lead.tags].map((t) => t.trim()).filter(Boolean))].filter(
    (t) => !projects.some((p) => p.tag.toLowerCase() === t.toLowerCase()),
  )
  if (plainTags.length > 0) {
    try {
      const { tagIdByKey } = await resolveImportTagIds(db, { accountId, userId, tagNames: plainTags, canCreateTags: true })
      for (const name of plainTags) {
        const tagId = tagIdByKey.get(name.toLowerCase())
        if (!tagId) continue
        const r = await addContactTagAndDispatch({ db, accountId, contactId, tagId, context })
        if (r.added) tagsAdded.push(name)
      }
    } catch (err) {
      console.error('[lead-intake] could not add tags:', err)
    }
  }
  if (match.project) {
    try {
      const r = await assignContactProject(db, { accountId, contactId, userId, project: match.project, context })
      if (r.added) tagsAdded.push(match.project.tag)
    } catch (err) {
      console.error('[lead-intake] could not add the project tag:', err)
    }
  }

  return {
    contact_id: contactId,
    conversation_id: resolved.conversationId,
    contact_created: resolved.contactCreated,
    project: match.project?.name ?? null,
    project_via: match.via,
    project_ambiguous: match.ambiguous,
    tags_added: tagsAdded,
    welcome: welcome.kind === 'template' ? { template: welcome.template, reason: welcome.reason } : { skipped: welcome.reason },
    message_sent: !!sent,
    ...(sendError ? { message_error: { code: sendError.code, error: sendError.message } } : {}),
  }
}
