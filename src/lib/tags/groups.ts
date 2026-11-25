/**
 * Tag groups (migration 054). A tag can sit in a named group — the
 * built-in one is "Project": every project tag from Integrations →
 * Real Expert → Projects lands there. Automations and flows can then
 * ask "does the contact have no / any / exactly one / more than one
 * tag in this group?", which is how a multi-project account tells a
 * single-project buyer from one interested in two projects.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const PROJECT_TAG_GROUP = 'Project'
export const MAX_GROUP_NAME = 40

export const TAG_GROUP_TESTS = ['none', 'any', 'one', 'more_than_one'] as const
export type TagGroupTest = (typeof TAG_GROUP_TESTS)[number]

export function isTagGroupTest(v: unknown): v is TagGroupTest {
  return typeof v === 'string' && (TAG_GROUP_TESTS as readonly string[]).includes(v)
}

/** Trimmed group name, or null for "no group". */
export function normaliseGroupName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/\s+/g, ' ').slice(0, MAX_GROUP_NAME)
  return s || null
}

export function sameGroup(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function passesGroupTest(count: number, test: TagGroupTest): boolean {
  switch (test) {
    case 'none':
      return count === 0
    case 'any':
      return count > 0
    case 'one':
      return count === 1
    case 'more_than_one':
      return count > 1
  }
}

export interface GroupTag {
  id: string
  name: string
  group_name: string | null
}

/** Every tag on the contact, with its group. Scoped to the account. */
export async function contactTagsWithGroups(db: Db, accountId: string, contactId: string): Promise<GroupTag[]> {
  const { data, error } = await db
    .from('contact_tags')
    .select('tag_id, tags!inner(id, name, group_name, account_id)')
    .eq('contact_id', contactId)
    .eq('tags.account_id', accountId)
  if (error) throw error
  const out: GroupTag[] = []
  for (const row of data ?? []) {
    const t = (row as { tags?: GroupTag | GroupTag[] }).tags
    const tag = Array.isArray(t) ? t[0] : t
    if (tag?.id) out.push({ id: tag.id, name: tag.name, group_name: tag.group_name ?? null })
  }
  return out
}

/** The contact's tags in one group (case-insensitive group match). */
export async function contactTagsInGroup(
  db: Db,
  accountId: string,
  contactId: string,
  group: string,
): Promise<GroupTag[]> {
  const all = await contactTagsWithGroups(db, accountId, contactId)
  return all.filter((t) => sameGroup(t.group_name, group))
}

/**
 * Put these tags (by name, case-insensitive) in a group — only tags
 * that are in no group yet, so a group the user chose by hand is kept.
 */
export async function assignTagsToGroup(
  db: Db,
  accountId: string,
  tagNames: string[],
  group: string,
): Promise<void> {
  const wanted = new Set(tagNames.map((n) => n.trim().toLowerCase()).filter(Boolean))
  if (wanted.size === 0) return
  const { data, error } = await db
    .from('tags')
    .select('id, name, group_name')
    .eq('account_id', accountId)
    .is('group_name', null)
  if (error) throw error
  const ids = (data ?? [])
    .filter((t) => wanted.has(String((t as { name: string }).name).trim().toLowerCase()))
    .map((t) => (t as { id: string }).id)
  if (ids.length === 0) return
  const { error: upErr } = await db.from('tags').update({ group_name: group }).eq('account_id', accountId).in('id', ids)
  if (upErr) throw upErr
}
