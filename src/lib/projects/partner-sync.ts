/**
 * Projects set from a partner CRM (Real Expert's signed settings API):
 * `{ [name|code]: { name?, tag?, code?, category? | type?, keywords?,
 * ad_ids? | meta_ad_ids?, ads?, welcome?, ai_instructions? | ai_notes?,
 * active? } | null }`. The key is used as the code when no code is sent. Each entry is
 * created or updated in the workspace's Projects (matched on code, tag,
 * then name); null deletes it; `replace` deletes projects not sent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { matchByValue, parseProjectInput, suggestTag, type Project } from './match'
import { ensureProjectTag, loadProjects } from './store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/** Partner shape → Projects API body (pure). */
export function partnerProjectBody(key: string, v: Record<string, unknown>): Record<string, unknown> {
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : key.trim()
  const ads = Array.isArray(v.ads) ? v.ads.map(String) : typeof v.ads === 'string' ? v.ads.split(',') : []
  const body: Record<string, unknown> = {
    name,
    tag: typeof v.tag === 'string' && v.tag.trim() ? v.tag.trim() : suggestTag(name),
  }
  // The key is the project code unless the entry names one itself.
  if (v.code !== undefined) body.code = v.code
  else if (/^[\p{L}\p{N}][\p{L}\p{N}._\-/ ]{0,59}$/u.test(key.trim())) body.code = key.trim()
  if (v.category !== undefined || v.type !== undefined) body.category = v.category ?? v.type
  const keywords = [
    ...(Array.isArray(v.keywords) ? v.keywords.map(String) : typeof v.keywords === 'string' ? v.keywords.split(',') : []),
    ...ads.filter((a) => !/^\s*\d+\s*$/.test(a)),
  ]
  const rawIds = v.ad_ids ?? v.meta_ad_ids
  const adIds = [...(Array.isArray(rawIds) ? rawIds.map(String) : typeof rawIds === 'string' ? rawIds.split(',') : []), ...ads.filter((a) => /^\s*\d+\s*$/.test(a))]
  if (v.keywords !== undefined || v.ads !== undefined) body.keywords = keywords
  if (rawIds !== undefined || v.ads !== undefined) body.ad_ids = adIds.map((a) => a.trim()).filter(Boolean)
  if (v.welcome === 'none') body.welcome_mode = 'none'
  else if (v.welcome && typeof v.welcome === 'object') {
    const w = v.welcome as Record<string, unknown>
    body.welcome_mode = 'template'
    body.welcome_template = w.template
    body.welcome_language = w.language ?? null
  } else if (v.welcome === null || v.welcome === 'default') body.welcome_mode = 'default'
  if (v.ai_instructions !== undefined || v.ai_notes !== undefined) body.ai_instructions = v.ai_instructions ?? v.ai_notes
  if (typeof v.active === 'boolean') body.is_active = v.active
  return body
}

export async function applyPartnerProjects(
  db: Db,
  args: { accountId: string; userId: string; projects: Record<string, unknown>; replace: boolean },
): Promise<{ errors: string[]; projects: Project[] }> {
  const { accountId, userId } = args
  const errors: string[] = []
  let current = await loadProjects(db, accountId)
  const touched = new Set<string>()

  for (const [key, raw] of Object.entries(args.projects)) {
    const existing = matchByValue(current, [key]).project
    if (raw === null) {
      if (existing) {
        await db.from('projects').delete().eq('id', existing.id).eq('account_id', accountId)
        current = current.filter((p) => p.id !== existing.id)
      }
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`projects.${key}`)
      continue
    }
    const body = partnerProjectBody(key, raw as Record<string, unknown>)
    const target =
      existing ?? matchByValue(current, [body.code, body.tag, body.name].filter(Boolean)).project
    const { value, errors: bad } = parseProjectInput(body, !!target)
    if (bad.length > 0) {
      errors.push(...bad.map((f) => `projects.${key}.${f}`))
      continue
    }
    const now = new Date().toISOString()
    const res = target
      ? await db.from('projects').update({ ...value, updated_at: now }).eq('id', target.id).eq('account_id', accountId).select('id').single()
      : await db.from('projects').insert({ ...value, account_id: accountId }).select('id').single()
    if (res.error) {
      errors.push(`projects.${key}${res.error.code === '23505' ? '.duplicate_tag_or_code' : ''}`)
      continue
    }
    touched.add((res.data as { id: string }).id)
    current = await loadProjects(db, accountId)
  }

  if (args.replace && errors.length === 0) {
    const stale = current.filter((p) => !touched.has(p.id)).map((p) => p.id)
    if (stale.length > 0) await db.from('projects').delete().eq('account_id', accountId).in('id', stale)
    current = current.filter((p) => !stale.includes(p.id))
  }
  for (const p of current) {
    if (touched.has(p.id)) await ensureProjectTag(db, accountId, userId, p).catch(() => undefined)
  }
  return { errors, projects: current }
}
