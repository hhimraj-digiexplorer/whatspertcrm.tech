import type { SupabaseClient } from '@supabase/supabase-js'

import { contactTagsInGroup, PROJECT_TAG_GROUP } from '@/lib/tags/groups'
import {
  parseOptions,
  projectForTags,
  REAL_EXPERT_PROVIDER,
  type ProjectSetting,
} from '@/lib/integrations/real-expert/config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/**
 * The contact's project tags (the "Project" tag group) and their display
 * names — the Real Expert project name when a project maps that tag.
 */
export async function loadProjectScope(
  db: Db,
  accountId: string,
  contactId: string,
): Promise<{ tagNames: string[]; displayNames: string[] }> {
  const tags = await contactTagsInGroup(db, accountId, contactId, PROJECT_TAG_GROUP)
  const tagNames = tags.map((t) => t.name)
  if (tagNames.length === 0) return { tagNames, displayNames: [] }
  let projects: Record<string, ProjectSetting> = {}
  try {
    const { data } = await db
      .from('crm_integrations')
      .select('options')
      .eq('account_id', accountId)
      .eq('provider', REAL_EXPERT_PROVIDER)
      .maybeSingle()
    if (data) projects = parseOptions((data as { options?: unknown }).options).options.projects
  } catch {
    // Display names are a nicety; tag names work too.
  }
  const displayNames = tagNames.map((name) => projectForTags(projects, [name])?.setting.name ?? name)
  return { tagNames, displayNames }
}
