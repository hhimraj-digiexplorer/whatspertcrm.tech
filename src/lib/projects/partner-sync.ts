/**
 * Projects set from a partner CRM (Real Expert's signed settings API):
 * `{ [name|code]: { name?, tag?, code?, category? | type?, keywords?,
 * ad_ids? | meta_ad_ids?, ads?, welcome?, ai_instructions? | ai_notes?,
 * active? } | null }`. The key is used as the code when no code is sent. Each entry is
 * created or updated in the workspace's Projects (matched on code, tag,
 * then name); null deletes it; `replace` deletes projects not sent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { CODE_RE, matchByValue, parseProjectInput, projectKey, suggestTag, type Project } from './match'
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
  else if (CODE_RE.test(key.trim())) body.code = key.trim()
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

/** One refused entry, worded for the Real Expert admin who sees it as "Last sync failed". */
export interface PartnerProjectError {
  field: string
  message: string
}

const FIELD_TEXT: Record<string, string> = {
  name: 'the name is missing or longer than 120 characters',
  tag: 'the WhatsApp tag must be 1–50 letters, digits or hyphens',
  code: 'the code must be 1–60 letters, digits, . _ - / or spaces',
  category: 'the type must be residential, villa, plot, commercial, mixed or other',
  keywords: 'keywords: up to 30, each 2–60 characters',
  ad_ids: 'Meta ad ids must be 3–30 digits each, up to 50',
  welcome_mode: 'the welcome must be a template, "default" or "none"',
  welcome_template: 'the welcome template name must be lowercase letters, digits and underscores, as approved in WhatsApp',
  welcome_language: 'the welcome language must be a code such as en or hi',
  ai_instructions: 'the AI notes are longer than 4,000 characters',
  is_active: 'active must be true or false',
}

/** "Project “HIM City” (GSR-HIM-01): …" */
export function projectErrorMessage(key: string, name: string | null, problem: string): string {
  return `Project ${name ? `“${name}” (${key})` : `“${key}”`}: ${problem}.`
}

/** Pure: which project a rename targets, and why it can't happen. */
export function planRename(
  projects: Project[],
  oldCode: string,
  newCode: string,
): { project: Project } | { error: string } {
  const from = projects.find((p) => p.code && projectKey(p.code) === projectKey(oldCode))
  if (!from) return { error: `Code “${oldCode}” is not set up in Whatspert, so it can't be renamed — sync the project instead.` }
  if (!CODE_RE.test(newCode)) return { error: `New code “${newCode}”: ${FIELD_TEXT.code}.` }
  const clash = projects.find((p) => p.id !== from.id && p.code && projectKey(p.code) === projectKey(newCode))
  if (clash) return { error: `Code “${newCode}” is already used by project “${clash.name}” in Whatspert.` }
  return { project: from }
}

export async function applyPartnerProjects(
  db: Db,
  args: {
    accountId: string
    userId: string
    projects: Record<string, unknown>
    replace: boolean
    /** Code changes, applied before `projects`: the project, its tag and its contacts stay the same. */
    renames?: { old_code: string; new_code: string }[]
  },
): Promise<{ errors: PartnerProjectError[]; projects: Project[] }> {
  const { accountId, userId } = args
  const errors: PartnerProjectError[] = []
  let current = await loadProjects(db, accountId)
  const touched = new Set<string>()

  for (const r of args.renames ?? []) {
    const oldCode = String(r?.old_code ?? '').trim()
    const newCode = String(r?.new_code ?? '').trim()
    if (!oldCode || !newCode || projectKey(oldCode) === projectKey(newCode)) continue
    const plan = planRename(current, oldCode, newCode)
    if ('error' in plan) {
      errors.push({ field: `rename_codes.${oldCode}`, message: plan.error })
      continue
    }
    const { error } = await db
      .from('projects')
      .update({ code: newCode, updated_at: new Date().toISOString() })
      .eq('id', plan.project.id)
      .eq('account_id', accountId)
    if (error) {
      errors.push({ field: `rename_codes.${oldCode}`, message: `Could not rename “${oldCode}” to “${newCode}” — please try again.` })
      continue
    }
    current = await loadProjects(db, accountId)
  }

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
      errors.push({ field: `projects.${key}`, message: projectErrorMessage(key, null, 'send the project as an object, or null to delete it') })
      continue
    }
    const body = partnerProjectBody(key, raw as Record<string, unknown>)
    const target =
      existing ?? matchByValue(current, [body.code, body.tag, body.name].filter(Boolean)).project
    const { value, errors: bad } = parseProjectInput(body, !!target)
    if (bad.length > 0) {
      const name = typeof body.name === 'string' ? body.name : null
      errors.push(
        ...bad.map((f) => ({ field: `projects.${key}.${f}`, message: projectErrorMessage(key, name, FIELD_TEXT[f] ?? `check ${f}`) })),
      )
      continue
    }
    const now = new Date().toISOString()
    const res = target
      ? await db.from('projects').update({ ...value, updated_at: now }).eq('id', target.id).eq('account_id', accountId).select('id').single()
      : await db.from('projects').insert({ ...value, account_id: accountId }).select('id').single()
    if (res.error) {
      const name = typeof body.name === 'string' ? body.name : null
      if (res.error.code === '23505') {
        const clash = current.find(
          (p) =>
            p.id !== target?.id &&
            (projectKey(p.tag) === projectKey(body.tag) || (!!p.code && projectKey(p.code) === projectKey(body.code))),
        )
        errors.push({
          field: `projects.${key}`,
          message: projectErrorMessage(
            key,
            name,
            clash
              ? `its code or WhatsApp tag is already used by project “${clash.name}” in Whatspert — give it a different one`
              : 'its code or WhatsApp tag is already used by another project in Whatspert',
          ),
        })
      } else {
        errors.push({ field: `projects.${key}`, message: projectErrorMessage(key, name, 'could not be saved — please try again') })
      }
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
