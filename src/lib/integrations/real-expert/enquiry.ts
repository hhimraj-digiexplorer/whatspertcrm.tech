/**
 * WhatsApp → Real Expert project enquiries (channel-partner request,
 * point 8). When a contact gets a tag in the "Project" group from
 * anything other than a Real Expert lead push (a Click-to-WhatsApp ad, a
 * flow, an automation, an agent), an `enquiry` job is queued:
 *
 *   - contact not in Real Expert yet → the job creates the lead for that
 *     project (unless a lead job is already waiting, which will carry the
 *     contact's projects itself);
 *   - contact already a lead → the job sends a repeat enquiry for the
 *     new project.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { PROJECT_TAG_GROUP, sameGroup } from '@/lib/tags/groups'
import { REAL_EXPERT_PROVIDER } from './config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export async function enqueueProjectEnquiry(
  db: Db,
  args: { accountId: string; contactId: string; tagId: string; source?: string },
): Promise<number> {
  const { accountId, contactId, tagId } = args
  // A lead push from Real Expert added this tag — never echo it back.
  if (args.source === 'real_expert') return 0

  const { data: tag } = await db
    .from('tags')
    .select('name, group_name')
    .eq('id', tagId)
    .eq('account_id', accountId)
    .maybeSingle()
  const t = tag as { name: string; group_name: string | null } | null
  if (!t || !sameGroup(t.group_name, PROJECT_TAG_GROUP)) return 0

  const { data: integrations } = await db
    .from('crm_integrations')
    .select('id, sync_new_leads')
    .eq('account_id', accountId)
    .eq('provider', REAL_EXPERT_PROVIDER)
    .eq('is_active', true)
  const active = ((integrations ?? []) as { id: string; sync_new_leads: boolean }[]).filter((i) => i.sync_new_leads)
  if (active.length === 0) return 0

  const { data: join } = await db
    .from('contact_tags')
    .select('id')
    .eq('contact_id', contactId)
    .eq('tag_id', tagId)
    .maybeSingle()
  const joinId = (join as { id: string } | null)?.id
  if (!joinId) return 0

  let queued = 0
  for (const integ of active) {
    const { data: link } = await db
      .from('crm_contact_links')
      .select('external_id')
      .eq('integration_id', integ.id)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (!link) {
      const { count } = await db
        .from('crm_sync_queue')
        .select('id', { count: 'exact', head: true })
        .eq('integration_id', integ.id)
        .eq('kind', 'lead')
        .eq('entity_id', contactId)
        .in('status', ['pending', 'running'])
      if ((count ?? 0) > 0) continue
    }
    const { error } = await db.from('crm_sync_queue').insert({
      integration_id: integ.id,
      account_id: accountId,
      kind: 'enquiry',
      entity_id: joinId,
      payload: { contact_id: contactId, tag_id: tagId, tag_name: t.name },
    })
    // 23505: the same enquiry is already waiting.
    if (error && error.code !== '23505') throw error
    if (!error) queued++
  }
  return queued
}
