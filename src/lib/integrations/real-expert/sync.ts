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
import { fillPath, parseOptions, extractExternalId, type RealExpertOptions } from './config'
import { realExpertRequest, RealExpertError, type RealExpertTarget } from './client'

/** Give up on a job after this many attempts. */
export const MAX_ATTEMPTS = 6

/** Minutes to wait before attempt n+1, indexed by attempts so far. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180]

export function retryDelayMs(attempts: number): number {
  const i = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)
  return BACKOFF_MINUTES[i] * 60_000
}

export type JobKind = 'lead' | 'deal' | 'message'

export interface SyncJob {
  id: number
  integration_id: string
  account_id: string
  kind: JobKind
  entity_id: string
  attempts: number
}

export interface ContactRow {
  id: string
  phone: string
  name: string | null
  email: string | null
  company: string | null
  created_at: string | null
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
  saveLink(contactId: string, externalId: string): Promise<void>
  send(path: string, body: unknown, idempotencyKey: string): Promise<unknown>
}

export type JobOutcome = 'done' | 'skipped'

export function buildLeadPayload(contact: ContactRow, options: RealExpertOptions) {
  return {
    name: contact.name && contact.name !== contact.phone ? contact.name : null,
    phone: `+${contact.phone.replace(/\D/g, '')}`,
    email: contact.email,
    company: contact.company,
    source: options.lead_source,
    whatspert_contact_id: contact.id,
    created_at: contact.created_at,
  }
}

export function buildDealPayload(deal: DealRow, leadId: string) {
  return {
    lead_id: leadId,
    whatspert_deal_id: deal.id,
    title: deal.title,
    value: deal.value === null ? null : Number(deal.value),
    currency: deal.currency,
    status: deal.status,
    stage: deal.stage ? { id: deal.stage.id, name: deal.stage.name, position: deal.stage.position } : null,
    pipeline: deal.pipeline ? { id: deal.pipeline.id, name: deal.pipeline.name } : null,
    expected_close_date: deal.expected_close_date,
    updated_at: deal.updated_at,
  }
}

export function buildMessagePayload(message: MessageRow, leadId: string) {
  return {
    lead_id: leadId,
    type: 'whatsapp_message',
    direction: message.sender_type === 'customer' ? 'inbound' : 'outbound',
    sender: message.sender_type,
    message_type: message.content_type,
    text: message.content_text,
    media_url: message.media_url,
    template_name: message.template_name,
    status: message.status,
    whatspert_message_id: message.id,
    whatsapp_message_id: message.message_id,
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
  const externalId = extractExternalId(res)
  if (!externalId) {
    throw new RealExpertError('Real Expert created the lead but did not return its id.', null, false)
  }
  await deps.saveLink(contact.id, externalId)
  return externalId
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
      await deps.send(
        fillPath(deps.options.deal_path, leadId),
        buildDealPayload(deal, leadId),
        `deal-${deal.id}-${deal.updated_at ?? ''}`,
      )
      return 'done'
    }
    case 'message': {
      const message = await deps.loadMessage(job.entity_id)
      if (!message) return 'skipped'
      const leadId = await ensureLead(message.contact_id, deps)
      if (!leadId) return 'skipped'
      await deps.send(
        fillPath(deps.options.message_path, leadId),
        buildMessagePayload(message, leadId),
        `message-${message.id}`,
      )
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

export function dbDeps(db: SupabaseClient, integration: IntegrationRow, target: RealExpertTarget): SyncDeps {
  const accountId = integration.account_id
  return {
    options: parseOptions(integration.options).options,
    async loadContact(id) {
      const { data } = await db
        .from('contacts')
        .select('id, phone, name, email, company, created_at')
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle()
      return (data as ContactRow | null) ?? null
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
      return { ...d, stage: one(d.stage as DealRow['stage']), pipeline: one(d.pipeline as DealRow['pipeline']) }
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
    const depsCache = new Map<string, SyncDeps | Error>()
    const touched = new Map<string, { ok: boolean; error: string | null }>()

    for (const job of claimed) {
      const integration = integrations.get(job.integration_id)
      if (!integration || !integration.is_active) {
        await finish(db, job.id, 'done', null)
        result.done++
        continue
      }
      let deps = depsCache.get(integration.id)
      if (!deps) {
        try {
          deps = dbDeps(db, integration, targetFor(integration))
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
