/**
 * Click-to-WhatsApp ad → project (channel-partner request, point 7).
 *
 * When a customer writes from a Meta ad, the inbound message carries a
 * `referral` (ad id, headline, text, link, click id). The webhook calls
 * `applyAdReferral` BEFORE the flow runner: the referral is saved on the
 * contact, and if one of Integrations → Real Expert → Projects lists that
 * ad (by id) or a word from it, the contact gets the project's tag — so
 * the project's own first-message flow opens instead of the picker.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { assignTagsToGroup, PROJECT_TAG_GROUP } from '@/lib/tags/groups'
import { parseOptions, projectForReferral, REAL_EXPERT_PROVIDER, type AdReferral } from './config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

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

export interface AdReferralResult {
  saved: boolean
  project: string | null
  tag_added: boolean
}

export async function applyAdReferral(
  db: Db,
  args: {
    accountId: string
    contactId: string
    conversationId: string
    userId: string
    referral: AdReferral
  },
): Promise<AdReferralResult> {
  const { accountId, contactId, conversationId, userId, referral } = args
  const result: AdReferralResult = { saved: false, project: null, tag_added: false }

  const { error: saveErr } = await db
    .from('contacts')
    .update({ ad_referral: { ...referral, received_at: new Date().toISOString() } })
    .eq('id', contactId)
    .eq('account_id', accountId)
  if (saveErr) console.error('[ad-referral] could not save the referral:', saveErr.message)
  else result.saved = true

  const { data: integration } = await db
    .from('crm_integrations')
    .select('options, is_active')
    .eq('account_id', accountId)
    .eq('provider', REAL_EXPERT_PROVIDER)
    .maybeSingle()
  if (!integration || (integration as { is_active?: boolean }).is_active === false) return result

  const { projects } = parseOptions((integration as { options?: unknown }).options).options
  const match = projectForReferral(projects, referral)
  if (!match) return result
  result.project = match.setting.name
  const tagName = match.setting.tag
  if (!tagName) return result

  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId,
    userId,
    tagNames: [tagName],
    canCreateTags: true,
  })
  await assignTagsToGroup(db, accountId, [tagName], PROJECT_TAG_GROUP).catch(() => undefined)
  const tagId = tagIdByKey.get(tagName.toLowerCase())
  if (!tagId) return result
  const r = await addContactTagAndDispatch({
    db,
    accountId,
    contactId,
    tagId,
    context: { conversation_id: conversationId, source: 'ad_referral' },
  })
  result.tag_added = r.added
  return result
}
