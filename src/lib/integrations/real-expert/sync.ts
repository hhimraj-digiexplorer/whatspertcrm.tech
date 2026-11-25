// ============================================================
// Real Expert sync worker — drains `crm_sync_queue`.
//
// Database triggers (migration 045) queue a job whenever a contact is
// created, a deal moves, or a message is saved, for accounts with the
// matching sync switched on. `drainCrmQueue` claims due jobs, pushes
// each to Real Expert and marks it done, or schedules a retry with
// back-off. It is called:
//   - after an inbound or outbound WhatsApp message (inside `after()`),
//   - by GET /api/integrations/cron on a schedule,
//   - by "Sync now" and after deal edits in the dashboard.
// It never throws.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { extractExternalId, fillPath, parseOptions, projectForTags, type RealExpertOptions } from './config'
import { PROJECT_TAG_GROUP, sameGroup } from '@/lib/tags/groups'
import { withWorkspaceProjects } from './projects-bridge'
import { realExpertRequest, RealExpertError, type RealExpertTarget } from './client'

/** Give up on a job after this many attempts. */
export const MAX_ATTEMPTS = 6

/** Minutes to wait before attempt n+1, indexed by attempts so far. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180]

export function retryDelayMs(attempts: number): number {
  const i = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)
  return BACKOFF_MINUTES[i] * 60_000
}

export type JobKind = 'lead' | 'deal' | 'message' | 'enquiry'

export interface SyncJob {
  id: number
  integration_id: string
  account_id: string
  kind: JobKind
  entity_id: string
  attempts: number
  /** enquiry jobs: { contact_id, tag_id, tag_name }. */
  payload?: Record<string, unknown> | null
}

export interface ContactRow {
  id: string
  phone: string
  name: string | null
  email: string | null
  company: string | null
  created_at: string | null
  /** The contact's tags in the "Project" group, oldest first. */
  project_tags?: string[]
}

export interface DealRow {
  id: string
  contact_id: string
  title: string
  value: number | string | null
  currency: string | null
  status: string | null
  expected_close_date: string | null
  updated_at: string | null
  stage: { id: string; name: string; position: number } | null
  pipeline: { id: string; name: string } | null
  /** The deal contact's tags in the "Project" group. */
  project_tags?: string[]
}

export interface MessageRow {
  id: string
  contact_id: string
  sender_type: string
  content_type: string
  content_text: string | null
  media_url: string | null
  template_name: string | null
  status: string | null
  message_id: string | null
  created_at: string | null
}

/** Data access + transport, injected so the job logic is testable. */
export interface SyncDeps {
  options: RealExpertOptions
  loadContact(id: string): Promise<ContactRow | null>
  loadDeal(id: string): Promise<DealRow | null>
  loadMessage(id: string): Promise<MessageRow | null>
  getLink(contactId: string): Promise<string | null>
  /** Real Expert enquiry ids we were pushed for this contact, newest first. */
  loadEnquiries?(contactId: string): Promise<EnquiryRow[]>
  /** Remember the enquiry id Real Expert returned for this contact + project. */
  saveEnquiry?(contactId: string, projectTag: string, enquiryId: string): Promise<void>
  saveLink(contactId: string, externalId: string): Promise<void>
  send(path: string, body: unknown, idempotencyKey: string): Promise<unknown>
}

export interface EnquiryRow {
  project_tag: string
  enquiry_id: string
}

/** The enquiry a message or deal belongs to: its project's, else the newest. */
export function pickEnquiry(enquiries: EnquiryRow[], projectTag?: string | null): string | null {
  if (enquiries.length === 0) return null
  if (projectTag) {
    const hit = enquiries.find((e) => e.project_tag.toLowerCase() === projectTag.toLowerCase())
    if (hit) return hit.enquiry_id
  }
  return enquiries[0].enquiry_id
}

export type JobOutcome = 'done' | 'skipped'

const looksLikeEmail = (v: string | null) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

/** Project fields for Real Expert, from a project tag (configured or not). */
export function projectFields(tag: string | null | undefined, options: RealExpertOptions) {
  if (!tag) return {}
  const match = projectForTags(options.projects, [tag])
  return {
    project: match?.setting.name ?? tag,
    project_code: match?.setting.code ?? null,
    project_tag: tag,
  }
}

/**
 * POST /v1/leads — creates the lead, or returns the existing one for that
 * phone. Carries the contact's (first) project so a WhatsApp-first lead
 * lands on the right project; `projectTag` overrides it for an enquiry.
 */
export function buildLeadPayload(contact: ContactRow, options: RealExpertOptions, projectTag?: string) {
  const phone = contact.phone.replace(/\D/g, '')
  const name = contact.name?.trim()
  const tag = projectTag ?? contact.project_tags?.[0]
  return {
    name: name && name.replace(/\D/g, '') !== phone ? name : null,
    phone: `+${phone}`,
    email: looksLikeEmail(contact.email) ? contact.email : null,
    company: contact.company,
    source: options.lead_source,
    whatspert_contact_id: contact.id,
    created_at: contact.created_at,
    ...projectFields(tag, options),
    // Every project the contact enquired about so far, so Real Expert can
    // open an enquiry per project when a lead arrives with several.
    ...(contact.project_tags && contact.project_tags.length > 0
      ? {
          project_tags: contact.project_tags,
          project_codes: contact.project_tags
            .map((t) => projectForTags(options.projects, [t])?.setting.code)
            .filter((c): c is string => !!c),
        }
      : {}),
  }
}

/**
 * Which project a deal is about: the project whose name or code is the
 * pipeline's name, else the contact's only project tag, else their first.
 */
export function dealProjectTag(deal: DealRow, options: RealExpertOptions): string | null {
  const tags = deal.project_tags ?? []
  if (tags.length === 0) return null
  const pipeline = deal.pipeline?.name.trim().toLowerCase()
  if (pipeline) {
    for (const tag of tags) {
      const p = projectForTags(options.projects, [tag])?.setting
      if (p && (p.name.toLowerCase() === pipeline || p.code?.toLowerCase() === pipeline || tag.toLowerCase() === pipeline)) {
        return tag
      }
    }
  }
  return tags[0]
}

const money = (v: DealRow['value']) => {
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * POST /v1/leads/{lead_id}/stage — Real Expert matches the stage name
 * against its own stages; an unmatched name is recorded as a note.
 */
export function buildStagePayload(deal: DealRow, options?: RealExpertOptions) {
  return {
    ...(options ? projectFields(dealProjectTag(deal, options), options) : {}),
    title: deal.title,
    value: money(deal.value),
    currency: deal.currency,
    status: deal.status,
    stage: deal.stage ? { name: deal.stage.name } : null,
    pipeline: deal.pipeline ? { name: deal.pipeline.name } : null,
    expected_close_date: deal.expected_close_date,
    whatspert_deal_id: deal.id,
    updated_at: deal.updated_at,
  }
}

/** POST /v1/leads/{lead_id}/activities — one row per WhatsApp message. */
export function buildMessagePayload(message: MessageRow) {
  return {
    type: 'whatsapp_message',
    direction: message.sender_type === 'customer' ? 'inbound' : 'outbound',
    sender: message.sender_type,
    message_type: message.content_type,
    text: message.content_text,
    media_url: message.media_url,
    template_name: message.template_name,
    status: message.status,
    whatsapp_message_id: message.message_id,
    whatspert_message_id: message.id,
    sent_at: message.created_at,
  }
}

/** Lead id for a contact, creating the lead in Real Expert if needed. */
async function ensureLead(contactId: string, deps: SyncDeps): Promise<string | null> {
  const linked = await deps.getLink(contactId)
  if (linked) return linked
  const contact = await deps.loadContact(contactId)
  if (!contact) return null
  const res = await deps.send(deps.options.leads_path, buildLeadPayload(contact, deps.options), `lead-${contact.id}`)
  const externalId = extractExternalId(res, ['id', 'lead_id', 'leadId', 'uuid'])
  if (!externalId) {
    throw new RealExpertError('Real Expert created the lead but did not return its id.', null, false)
  }
  await deps.saveLink(contact.id, externalId)
  await rememberEnquiry(res, contact.id, contact.project_tags?.[0] ?? '', deps)
  return externalId
}

/** Store `enquiry_id` from Real Expert's reply, when it sends one. Best-effort. */
async function rememberEnquiry(res: unknown, contactId: string, projectTag: string, deps: SyncDeps): Promise<void> {
  const enquiryId = extractExternalId(res, ['enquiry_id', 'enquiryId'])
  if (!enquiryId || !deps.saveEnquiry) return
  await deps.saveEnquiry(contactId, projectTag, enquiryId).catch(() => undefined)
}

/** Push one job. Throws `RealExpertError` (or anything) on failure. */
export async function processJob(job: SyncJob, deps: SyncDeps): Promise<JobOutcome> {
  switch (job.kind) {
    case 'lead': {
      // Already in Real Expert (created there, or by an earlier job).
      if (await deps.getLink(job.entity_id)) return 'skipped'
      return (await ensureLead(job.entity_id, deps)) ? 'done' : 'skipped'
    }
    case 'deal': {
      const deal = await deps.loadDeal(job.entity_id)
      if (!deal) return 'skipped'
      const leadId = await ensureLead(deal.contact_id, deps)
      if (!leadId) return 'skipped'
      const enquiries = deps.loadEnquiries ? await deps.loadEnquiries(deal.contact_id) : []
      const enquiryId = pickEnquiry(enquiries, dealProjectTag(deal, deps.options))
      await deps.send(
        fillPath(deps.options.stage_path, leadId),
        { ...buildStagePayload(deal, deps.options), ...(enquiryId ? { enquiry_id: enquiryId } : {}) },
        `deal-${deal.id}-${deal.updated_at ?? ''}`,
      )
      return 'done'
    }
    case 'message': {
      const message = await deps.loadMessage(job.entity_id)
      if (!message) return 'skipped'
      const leadId = await ensureLead(message.contact_id, deps)
      if (!leadId) return 'skipped'
      // A WhatsApp message belongs to the buyer's latest enquiry.
      const enquiries = deps.loadEnquiries ? await deps.loadEnquiries(message.contact_id) : []
      const enquiryId = pickEnquiry(enquiries)
      await deps.send(
        fillPath(deps.options.activities_path, leadId),
        { ...buildMessagePayload(message), ...(enquiryId ? { enquiry_id: enquiryId } : {}) },
        `message-${message.id}`,
      )
      return 'done'
    }
    case 'enquiry': {
      // A contact enquired about a project from WhatsApp (ad, flow,
      // agent). Not yet in Real Expert → create the lead for that
      // project. Already there → send the same lead push flagged as a
      // repeat enquiry for that project.
      const p = job.payload ?? {}
      const contactId = typeof p.contact_id === 'string' ? p.contact_id : null
      const tag = typeof p.tag_name === 'string' ? p.tag_name : null
      if (!contactId || !tag) return 'skipped'
      const contact = await deps.loadContact(contactId)
      if (!contact) return 'skipped'
      // The tag was taken off again before we got to it.
      if (contact.project_tags && !contact.project_tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        return 'skipped'
      }
      const linked = await deps.getLink(contactId)
      if (!linked) {
        const res = await deps.send(
          deps.options.leads_path,
          buildLeadPayload(contact, deps.options, tag),
          `lead-${contact.id}`,
        )
        const externalId = extractExternalId(res, ['id', 'lead_id', 'leadId', 'uuid'])
        if (!externalId) {
          throw new RealExpertError('Real Expert created the lead but did not return its id.', null, false)
        }
        await deps.saveLink(contact.id, externalId)
        await rememberEnquiry(res, contact.id, tag, deps)
        return 'done'
      }
      const repeatRes = await deps.send(
        deps.options.leads_path,
        { ...buildLeadPayload(contact, deps.options, tag), is_repeat_enquiry: true, lead_id: linked },
        `enquiry-${contact.id}-${typeof p.tag_id === 'string' ? p.tag_id : tag}`,
      )
      await rememberEnquiry(repeatRes, contact.id, tag, deps)
      return 'done'
    }
    default:
      return 'skipped'
  }
}

// ------------------------------------------------------------
// Database-backed deps + the drain loop
// ------------------------------------------------------------

interface IntegrationRow {
  id: string
  account_id: string
  is_active: boolean
  base_url: string
  api_key: string
  options: unknown
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/** The contact's "Project" group tags, oldest first. Best-effort ([] on error). */
async function projectTagsOf(db: SupabaseClient, accountId: string, contactId: string): Promise<string[]> {
  try {
    const { data } = await db
      .from('contact_tags')
      .select('created_at, tags!inner(name, group_name, account_id)')
      .eq('contact_id', contactId)
      .eq('tags.account_id', accountId)
      .order('created_at', { ascending: true })
    const out: string[] = []
    for (const row of data ?? []) {
      const tag = one((row as { tags?: unknown }).tags as { name: string; group_name: string | null } | null)
      if (tag && sameGroup(tag.group_name, PROJECT_TAG_GROUP)) out.push(tag.name)
    }
    return out
  } catch {
    return []
  }
}

export function dbDeps(db: SupabaseClient, integration: IntegrationRow, target: RealExpertTarget): SyncDeps {
  const accountId = integration.account_id
  const options = parseOptions(integration.options).options
  return {
    options,
    async loadContact(id) {
      const { data } = await db
        .from('contacts')
        .select('id, phone, name, email, company, created_at')
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!data) return null
      return { ...(data as ContactRow), project_tags: await projectTagsOf(db, accountId, id) }
    },
    async loadDeal(id) {
      const { data } = await db
        .from('deals')
        .select(
          'id, contact_id, title, value, currency, status, expected_close_date, updated_at, stage:pipeline_stages(id, name, position), pipeline:pipelines(id, name)',
        )
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!data) return null
      const d = data as unknown as DealRow & { stage: unknown; pipeline: unknown }
      return {
        ...d,
        stage: one(d.stage as DealRow['stage']),
        pipeline: one(d.pipeline as DealRow['pipeline']),
        project_tags: await projectTagsOf(db, accountId, d.contact_id),
      }
    },
    async loadMessage(id) {
      const { data } = await db
        .from('messages')
        .select(
          'id, sender_type, content_type, content_text, media_url, template_name, status, message_id, created_at, conversation:conversations!inner(contact_id, account_id)',
        )
        .eq('id', id)
        .eq('conversation.account_id', accountId)
        .maybeSingle()
      if (!data) return null
      const m = data as unknown as Omit<MessageRow, 'contact_id'> & { conversation: unknown }
      const conv = one(m.conversation as { contact_id: string } | { contact_id: string }[] | null)
      if (!conv) return null
      return { ...m, contact_id: conv.contact_id }
    },
    async getLink(contactId) {
      const { data } = await db
        .from('crm_contact_links')
        .select('external_id')
        .eq('integration_id', integration.id)
        .eq('contact_id', contactId)
        .maybeSingle()
      return (data as { external_id: string } | null)?.external_id ?? null
    },
    async saveEnquiry(contactId, projectTag, enquiryId) {
      const { data: rows } = await db
        .from('crm_enquiries')
        .select('id, project_tag')
        .eq('integration_id', integration.id)
        .eq('contact_id', contactId)
      const hit = ((rows ?? []) as { id: string; project_tag: string }[]).find(
        (r) => r.project_tag.toLowerCase() === projectTag.toLowerCase(),
      )
      const now = new Date().toISOString()
      if (hit) await db.from('crm_enquiries').update({ enquiry_id: enquiryId, updated_at: now }).eq('id', hit.id)
      else
        await db.from('crm_enquiries').insert({
          integration_id: integration.id,
          account_id: accountId,
          contact_id: contactId,
          project_tag: projectTag,
          enquiry_id: enquiryId,
        })
    },
        async loadEnquiries(contactId) {
      const { data } = await db
        .from('crm_enquiries')
        .select('project_tag, enquiry_id, updated_at')
        .eq('integration_id', integration.id)
        .eq('contact_id', contactId)
        .order('updated_at', { ascending: false })
      return ((data ?? []) as EnquiryRow[]).map((r) => ({ project_tag: r.project_tag, enquiry_id: r.enquiry_id }))
    },
        async saveLink(contactId, externalId) {
      const { error } = await db.from('crm_contact_links').upsert(
        { integration_id: integration.id, contact_id: contactId, account_id: accountId, external_id: externalId },
        { onConflict: 'integration_id,contact_id', ignoreDuplicates: true },
      )
      if (error) throw error
    },
    send(path, body, idempotencyKey) {
      return realExpertRequest(target, 'POST', path, body, { 'Idempotency-Key': `whatspert-${idempotencyKey}` })
    },
  }
}

export function targetFor(integration: { base_url: string; api_key: string; options: unknown }): RealExpertTarget {
  return {
    baseUrl: integration.base_url,
    apiKey: decrypt(integration.api_key),
    authStyle: parseOptions(integration.options).options.auth_style,
  }
}

export interface DrainResult {
  claimed: number
  done: number
  retrying: number
  failed: number
}

/**
 * Claim and push up to `limit` due jobs, for one account or (cron) for
 * all. Jobs run one at a time in queue order, so a contact's lead is
 * created before its deal and messages are pushed.
 */
export async function drainCrmQueue(
  db: SupabaseClient,
  opts: { accountId?: string | null; limit?: number } = {},
): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, done: 0, retrying: 0, failed: 0 }
  try {
    const { data: jobs, error } = await db.rpc('crm_claim_jobs', {
      p_account_id: opts.accountId ?? null,
      p_limit: opts.limit ?? 25,
    })
    if (error || !jobs || (jobs as SyncJob[]).length === 0) return result
    const claimed = jobs as SyncJob[]
    result.claimed = claimed.length

    const ids = [...new Set(claimed.map((j) => j.integration_id))]
    const { data: rows } = await db
      .from('crm_integrations')
      .select('id, account_id, is_active, base_url, api_key, options')
      .in('id', ids)
    const integrations = new Map((rows as IntegrationRow[] | null ?? []).map((r) => [r.id, r]))
    // The add-on only runs while both Real Expert and WhatsApp are paid.
    const entitled = new Map<string, boolean>()
    for (const id of integrations.keys()) {
      const { data: ok } = await db.rpc('crm_integration_entitled', { p_integration_id: id })
      entitled.set(id, ok === true)
    }
    const depsCache = new Map<string, SyncDeps | Error>()
    const touched = new Map<string, { ok: boolean; error: string | null }>()

    for (const job of claimed) {
      const integration = integrations.get(job.integration_id)
      if (!integration || !integration.is_active) {
        await finish(db, job.id, 'done', null)
        result.done++
        continue
      }
      if (!entitled.get(integration.id)) {
        await finish(db, job.id, 'failed', 'WhatsApp add-on is locked: Real Expert and WhatsApp plans must both be paid.')
        result.failed++
        continue
      }
      let deps = depsCache.get(integration.id)
      if (!deps) {
        try {
          deps = dbDeps(db, integration, targetFor(integration))
          // Project names / codes come from the workspace's Projects.
          deps.options = await withWorkspaceProjects(db, integration.account_id, deps.options)
        } catch {
          deps = new Error('The saved API key could not be read. Please enter it again.')
        }
        depsCache.set(integration.id, deps)
      }

      try {
        if (deps instanceof Error) throw new RealExpertError(deps.message, null, false)
        await processJob(job, deps)
        await finish(db, job.id, 'done', null)
        result.done++
        touched.set(integration.id, { ok: true, error: touched.get(integration.id)?.error ?? null })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        const retryable = !(err instanceof RealExpertError) || err.retryable
        if (retryable && job.attempts < MAX_ATTEMPTS) {
          await retryLater(db, job, message)
          result.retrying++
        } else {
          await finish(db, job.id, 'failed', message)
          result.failed++
        }
        touched.set(integration.id, { ok: touched.get(integration.id)?.ok ?? false, error: message })
      }
    }

    const now = new Date().toISOString()
    for (const [id, t] of touched) {
      const patch: Record<string, unknown> = {}
      if (t.ok) patch.last_sync_at = now
      if (t.error) {
        patch.last_error = t.error.slice(0, 500)
        patch.last_error_at = now
      }
      await db.from('crm_integrations').update(patch).eq('id', id)
    }
  } catch (err) {
    console.error('[crm-sync] drain failed:', err)
  }
  return result
}

async function finish(db: SupabaseClient, id: number, status: 'done' | 'failed', error: string | null) {
  await db
    .from('crm_sync_queue')
    .update({ status, last_error: error?.slice(0, 500) ?? null, updated_at: new Date().toISOString() })
    .eq('id', id)
}

async function retryLater(db: SupabaseClient, job: SyncJob, error: string) {
  const { error: updErr } = await db
    .from('crm_sync_queue')
    .update({
      status: 'pending',
      last_error: error.slice(0, 500),
      next_attempt_at: new Date(Date.now() + retryDelayMs(job.attempts)).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
  // A newer pending job for the same entity already exists and will
  // push the latest state — this one can be closed.
  if (updErr) await finish(db, job.id, 'done', null)
}
