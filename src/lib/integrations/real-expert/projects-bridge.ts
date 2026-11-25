/**
 * Real Expert reads projects from the workspace's Projects (migration
 * 055) — the same list every other lead source uses. Older settings kept
 * in the integration's options (migrations 053/054) still count for any
 * project not yet in the table.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Project } from '@/lib/projects/match'
import { loadProjects } from '@/lib/projects/store'
import { sourceKey, type ProjectSetting, type RealExpertOptions } from './config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export function toProjectSetting(p: Project): ProjectSetting {
  const s: ProjectSetting = { name: p.name, tag: p.tag }
  if (p.code) s.code = p.code
  const ads = [...p.ad_ids, ...p.keywords]
  if (ads.length > 0) s.ads = ads
  if (p.welcome_mode === 'none') s.welcome = 'none'
  else if (p.welcome_mode === 'template' && p.welcome_template) {
    s.welcome = p.welcome_language
      ? { template: p.welcome_template, language: p.welcome_language }
      : { template: p.welcome_template }
  }
  return s
}

/** Table projects (active only) merged over legacy option projects. */
export function mergeProjectSettings(
  legacy: Record<string, ProjectSetting>,
  projects: Project[],
): Record<string, ProjectSetting> {
  const out: Record<string, ProjectSetting> = {}
  const tableTags = new Set(projects.map((p) => p.tag.toLowerCase()))
  for (const [k, s] of Object.entries(legacy)) {
    if (s.tag && tableTags.has(s.tag.toLowerCase())) continue
    out[k] = s
  }
  for (const p of projects) {
    if (!p.is_active) continue
    const key = sourceKey(p.code ?? p.tag) || sourceKey(p.name)
    if (key) out[key] = toProjectSetting(p)
  }
  return out
}

/** Options with `projects` replaced by the merged workspace list. */
export async function withWorkspaceProjects(
  db: Db,
  accountId: string,
  options: RealExpertOptions,
): Promise<RealExpertOptions> {
  try {
    const projects = await loadProjects(db, accountId)
    return { ...options, projects: mergeProjectSettings(options.projects, projects) }
  } catch (err) {
    console.error('[real-expert] could not load workspace projects:', err)
    return options
  }
}
