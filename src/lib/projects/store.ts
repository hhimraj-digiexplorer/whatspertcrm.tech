/**
 * Projects (migration 055) — database side: load a workspace's projects,
 * put a contact on a project (its tag, in the "Project" tag group, with
 * Tag Added automations), and read a contact's projects back.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import type { AutomationContext } from '@/lib/automations/engine'
import { contactTagsInGroup, PROJECT_TAG_GROUP } from '@/lib/tags/groups'
import { projectForTag, type Project } from './match'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const PROJECT_COLUMNS =
  'id, name, code, category, tag, keywords, ad_ids, welcome_mode, welcome_template, welcome_language, ai_instructions, is_active'

const PROJECT_TAG_COLOR = '#8b5cf6'

function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    code: (row.code as string | null) ?? null,
    category: (row.category as Project['category']) ?? 'residential',
    tag: String(row.tag ?? ''),
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    ad_ids: Array.isArray(row.ad_ids) ? (row.ad_ids as string[]) : [],
    welcome_mode: (row.welcome_mode as Project['welcome_mode']) ?? 'default',
    welcome_template: (row.welcome_template as string | null) ?? null,
    welcome_language: (row.welcome_language as string | null) ?? null,
    ai_instructions: (row.ai_instructions as string | null) ?? null,
    is_active: row.is_active !== false,
  }
}

/** Every project in the workspace (active and paused), oldest first. */
export async function loadProjects(db: Db, accountId: string): Promise<Project[]> {
  const { data, error } = await db
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(toProject)
}

/**
 * The project's tag id — created (in the "Project" group) when missing,
 * and moved into the group when it exists ungrouped.
 */
export async function ensureProjectTag(db: Db, accountId: string, userId: string, project: Project): Promise<string> {
  const { data: rows, error } = await db
    .from('tags')
    .select('id, name, group_name')
    .eq('account_id', accountId)
    .ilike('name', project.tag.replace(/[%_\\]/g, (c) => `\\${c}`))
  if (error) throw error
  const existing = ((rows ?? []) as { id: string; name: string; group_name: string | null }[]).find(
    (t) => t.name.toLowerCase() === project.tag.toLowerCase(),
  )
  if (existing) {
    if (!existing.group_name) {
      await db.from('tags').update({ group_name: PROJECT_TAG_GROUP }).eq('id', existing.id).eq('account_id', accountId)
    }
    return existing.id
  }
  const { data: created, error: insErr } = await db
    .from('tags')
    .insert({ account_id: accountId, user_id: userId, name: project.tag, color: PROJECT_TAG_COLOR, group_name: PROJECT_TAG_GROUP })
    .select('id')
    .single()
  if (insErr || !created) {
    // A concurrent request created it first.
    const { data: again } = await db.from('tags').select('id, name').eq('account_id', accountId).ilike('name', project.tag)
    const hit = ((again ?? []) as { id: string; name: string }[]).find((t) => t.name.toLowerCase() === project.tag.toLowerCase())
    if (hit) return hit.id
    throw insErr ?? new Error('Could not create the project tag')
  }
  return (created as { id: string }).id
}

/**
 * Put the contact on this project: add its tag (fires Tag Added, queues a
 * CRM enquiry unless the context says the CRM itself sent it).
 * Returns whether the tag was new for this contact.
 */
export async function assignContactProject(
  db: Db,
  args: {
    accountId: string
    contactId: string
    userId: string
    project: Project
    context?: AutomationContext
  },
): Promise<{ tagId: string; added: boolean }> {
  const tagId = await ensureProjectTag(db, args.accountId, args.userId, args.project)
  const r = await addContactTagAndDispatch({
    db,
    accountId: args.accountId,
    contactId: args.contactId,
    tagId,
    context: args.context,
  })
  return { tagId, added: r.added }
}

export interface ContactProjects {
  /** The contact's tags in the "Project" group, by name. */
  tagNames: string[]
  /** Configured projects among them (same order). */
  projects: Project[]
}

/** Which projects the contact is on (tags in the "Project" group). */
export async function loadContactProjects(
  db: Db,
  accountId: string,
  contactId: string,
  projects?: Project[],
): Promise<ContactProjects> {
  const tags = await contactTagsInGroup(db, accountId, contactId, PROJECT_TAG_GROUP)
  const tagNames = tags.map((t) => t.name)
  if (tagNames.length === 0) return { tagNames, projects: [] }
  const all = projects ?? (await loadProjects(db, accountId))
  return {
    tagNames,
    projects: tagNames.map((n) => projectForTag(all, n)).filter((p): p is Project => !!p),
  }
}
