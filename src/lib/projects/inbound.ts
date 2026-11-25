/**
 * WhatsApp messages → project (channel partners). Called by the webhook
 * for every customer message BEFORE the flow runner, so the project's
 * own flow, automations and AI agent take the chat from its first
 * message:
 *
 *   - a Click-to-WhatsApp ad: the referral (ad id, headline, text, link)
 *     is saved on the contact and matched by ad id, then by keyword;
 *   - a plain chat — website "Chat on WhatsApp" button, pre-filled text,
 *     a QR code: the message is matched by keyword, but only while the
 *     contact has no project yet (so a buyer of project A asking "is B
 *     cheaper?" is not silently moved — the AI / a person handles that).
 *
 * Ambiguous matches (two projects) tag nothing: the project picker or a
 * person decides. Works with or without any CRM integration.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveProject, type Project, type ProjectMatch } from './match'
import { assignContactProject, loadContactProjects, loadProjects } from './store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/** What Meta sends with a message that came from a Click-to-WhatsApp ad. */
export interface AdReferral {
  source_id?: string
  source_type?: string
  source_url?: string
  headline?: string
  body?: string
  ctwa_clid?: string
}

const FIELDS: (keyof AdReferral)[] = ['source_id', 'source_type', 'source_url', 'headline', 'body', 'ctwa_clid']

/** Keep only the known string fields, clipped. Null when nothing useful arrived. */
export function parseReferral(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: AdReferral = {}
  for (const f of FIELDS) {
    const v = r[f]
    if (typeof v === 'string' && v.trim()) out[f] = v.trim().slice(0, f === 'body' ? 1000 : 500)
  }
  return out.source_id || out.source_url || out.headline ? out : null
}

/** Which project an inbound message points to (pure). */
export function inboundProjectMatch(
  projects: Project[],
  args: { referral: AdReferral | null; text: string | null; contactHasProject: boolean },
): ProjectMatch {
  const { referral, text, contactHasProject } = args
  return resolveProject(projects, {
    adId: referral?.source_id,
    sourceTexts: referral ? [referral.headline, referral.body, referral.source_url] : [],
    messageText: !contactHasProject ? text : null,
  })
}

export interface InboundProjectResult {
  project: string | null
  via: ProjectMatch['via']
  ambiguous: boolean
  tag_added: boolean
}

export async function applyInboundProject(
  db: Db,
  args: {
    accountId: string
    contactId: string
    conversationId: string
    userId: string
    referral: AdReferral | null
    text: string | null
  },
): Promise<InboundProjectResult> {
  const { accountId, contactId, conversationId, userId, referral, text } = args
  const result: InboundProjectResult = { project: null, via: null, ambiguous: false, tag_added: false }

  if (referral) {
    const { error } = await db
      .from('contacts')
      .update({
        ad_referral: { ...referral, received_at: new Date().toISOString() },
        lead_meta: {
          channel: 'whatsapp_ad',
          ad_id: referral.source_id ?? null,
          ad_headline: referral.headline ?? null,
          source_url: referral.source_url ?? null,
          received_at: new Date().toISOString(),
        },
      })
      .eq('id', contactId)
      .eq('account_id', accountId)
    if (error) console.error('[projects] could not save the ad referral:', error.message)
  }

  const projects = (await loadProjects(db, accountId)).filter((p) => p.is_active)
  if (projects.length === 0) return result
  // Without a referral, a message only places a contact with no project.
  const current = await loadContactProjects(db, accountId, contactId, projects)
  const contactHasProject = current.tagNames.length > 0
  if (!referral && contactHasProject) return result

  const match = inboundProjectMatch(projects, { referral, text, contactHasProject })
  result.ambiguous = match.ambiguous
  if (!match.project) return result
  result.project = match.project.name
  result.via = match.via
  const r = await assignContactProject(db, {
    accountId,
    contactId,
    userId,
    project: match.project,
    context: { conversation_id: conversationId, source: referral ? 'ad_referral' : 'whatsapp_message' },
  })
  result.tag_added = r.added
  return result
}
