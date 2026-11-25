/**
 * After a tag is added: when it is a project tag ("Project" tag group),
 * tell the outside world — every CRM, not just Real Expert:
 *   - the `contact.project_added` outgoing webhook (Settings → API);
 *   - a Real Expert enquiry job, when Real Expert is connected.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { enqueueProjectEnquiry } from '@/lib/integrations/real-expert/enquiry'
import { PROJECT_TAG_GROUP, sameGroup } from '@/lib/tags/groups'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { projectForTag } from './match'
import { loadContactProjects, loadProjects } from './store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export async function onContactTagAdded(
  db: Db,
  args: { accountId: string; contactId: string; tagId: string; source?: string },
): Promise<void> {
  const { data: tag } = await db
    .from('tags')
    .select('name, group_name')
    .eq('id', args.tagId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  const t = tag as { name: string; group_name: string | null } | null
  if (!t || !sameGroup(t.group_name, PROJECT_TAG_GROUP)) return

  try {
    await enqueueProjectEnquiry(db, args)
  } catch (err) {
    console.error('[projects] could not queue the CRM enquiry:', err)
  }

  try {
    const projects = await loadProjects(db, args.accountId)
    const project = projectForTag(projects, t.name)
    const [{ data: contact }, all] = await Promise.all([
      db.from('contacts').select('id, phone, name, email').eq('id', args.contactId).eq('account_id', args.accountId).maybeSingle(),
      loadContactProjects(db, args.accountId, args.contactId, projects),
    ])
    await dispatchWebhookEvent(db, args.accountId, 'contact.project_added', {
      contact: contact ?? { id: args.contactId },
      project: {
        id: project?.id ?? null,
        name: project?.name ?? t.name,
        code: project?.code ?? null,
        category: project?.category ?? null,
        tag: t.name,
      },
      // Every project the contact is on now; > 1 means a repeat enquiry.
      project_tags: all.tagNames,
      is_repeat_enquiry: all.tagNames.length > 1,
      source: args.source ?? null,
    })
  } catch (err) {
    console.error('[projects] could not send contact.project_added:', err)
  }
}
