import type { SupabaseClient } from '@supabase/supabase-js'

import { countPlaceholders } from '@/lib/integrations/real-expert/settings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/**
 * Variables for an automatic welcome template: whatever the lead source
 * sent, else the lead's first name for {{1}} (and its full name for any
 * others), matching the number of placeholders in the approved body.
 */
export async function defaultTemplateParams(
  db: Db,
  accountId: string,
  templateName: string,
  supplied: unknown,
  name: string | null,
): Promise<string[]> {
  if (Array.isArray(supplied)) return supplied.map((v) => String(v ?? ''))
  const { data } = await db
    .from('message_templates')
    .select('body_text')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .limit(1)
    .maybeSingle()
  const n = countPlaceholders((data as { body_text?: string } | null)?.body_text)
  if (n === 0) return []
  const first = name?.split(/\s+/)[0] || 'there'
  return Array.from({ length: n }, (_, i) => (i === 0 ? first : name || first))
}
