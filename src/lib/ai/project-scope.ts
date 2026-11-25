import type { SupabaseClient } from '@supabase/supabase-js'

import { loadContactProjects } from '@/lib/projects/store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface ProjectScope {
  /** The contact's tags in the "Project" group — knowledge documents are filtered on these. */
  tagNames: string[]
  /** Project names for the prompt ("AIS Galleria (villas)"); the tag when not configured. */
  displayNames: string[]
  /** Each configured project's own AI notes, "Name: notes". */
  instructions: string[]
}

const CATEGORY_LABEL: Record<string, string> = {
  residential: 'residential apartments',
  villa: 'villas',
  plot: 'plots',
  commercial: 'commercial spaces',
  mixed: 'mixed use',
}

/** The contact's projects, for the AI agent's per-project mode. */
export async function loadProjectScope(db: Db, accountId: string, contactId: string): Promise<ProjectScope> {
  const { tagNames, projects } = await loadContactProjects(db, accountId, contactId).catch(() => ({
    tagNames: [] as string[],
    projects: [],
  }))
  const byTag = new Map(projects.map((p) => [p.tag.toLowerCase(), p]))
  const displayNames = tagNames.map((t) => {
    const p = byTag.get(t.toLowerCase())
    if (!p) return t
    const cat = CATEGORY_LABEL[p.category]
    return cat ? `${p.name} (${cat})` : p.name
  })
  const instructions = projects
    .filter((p) => p.ai_instructions && p.ai_instructions.trim())
    .map((p) => `${p.name}: ${p.ai_instructions!.trim()}`)
  return { tagNames, displayNames, instructions }
}
