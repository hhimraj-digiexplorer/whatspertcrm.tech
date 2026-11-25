import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseOptions, projectTagNames, sourceKey } from '@/lib/integrations/real-expert/config'
import { assignTagsToGroup, PROJECT_TAG_GROUP } from '@/lib/tags/groups'
import { findPartnerIntegration, readPartnerRequest } from '@/lib/partner/server'

/**
 * POST /api/partner/real-expert/settings  (signed)
 * Body: { ref,
 *         greeting_by?: 'whatspert' | 'real_expert',
 *         welcome_template?: { name, language? } | null,
 *         source_tags?: { [source]: tag | "" },     // "" removes one
 *         replace_source_tags?: boolean,            // default: merge
 *         projects?: { [name|code]: { name?, tag?, code?, ads?: string[], welcome?: { template, language? } | 'none' } | null },
 *         replace_projects?: boolean,               // default: merge; null removes one
 *         fallback_welcome?: boolean }              // default welcome for unmatched projects
 *
 * Lets Real Expert set, for one linked workspace, who greets new leads,
 * the welcome template Whatspert sends when it greets, and the
 * lead source → tag mapping. Every field is optional; send only `ref`
 * to read the current values. Same values as Integrations → Real Expert
 * CRM in Whatspert; whichever side saves last wins.
 */
export async function POST(request: Request) {
  const read = await readPartnerRequest(request)
  if (read instanceof NextResponse) return read
  const b = read.body
  const db = supabaseAdmin()

  const integration = await findPartnerIntegration(db, b.ref as string)
  if (!integration) {
    return NextResponse.json({ error: 'This workspace is not linked to Whatspert yet.', code: 'not_linked' }, { status: 404 })
  }

  const { data: row, error } = await db
    .from('crm_integrations')
    .select('options, welcome_template_name, welcome_template_language')
    .eq('id', integration.id)
    .single()
  if (error || !row) return NextResponse.json({ error: 'Could not load the settings.' }, { status: 500 })

  const stored = parseOptions(row.options).options
  const patch: Record<string, unknown> = {}
  if (b.greeting_by !== undefined) patch.greeting_by = b.greeting_by
  if (b.source_tags !== undefined) {
    if (!b.source_tags || typeof b.source_tags !== 'object' || Array.isArray(b.source_tags)) {
      return NextResponse.json({ error: 'source_tags must be an object of source → tag.', field: 'source_tags' }, { status: 400 })
    }
    const incoming = b.source_tags as Record<string, unknown>
    // Merge by default; "" / null removes one mapping.
    patch.source_tags = b.replace_source_tags === true ? incoming : { ...stored.source_tags, ...incoming }
  }
  if (b.fallback_welcome !== undefined) patch.fallback_welcome = b.fallback_welcome
  if (b.projects !== undefined) {
    if (!b.projects || typeof b.projects !== 'object' || Array.isArray(b.projects)) {
      return NextResponse.json({ error: 'projects must be an object of project → settings.', field: 'projects' }, { status: 400 })
    }
    // Stored keys are normalised; normalise incoming the same way so a
    // merge updates rather than duplicates. null removes one project.
    const base: Record<string, unknown> = b.replace_projects === true ? {} : { ...stored.projects }
    for (const [k, v] of Object.entries(b.projects as Record<string, unknown>)) {
      const key = sourceKey(k)
      if (!key) continue
      if (v === null) delete base[key]
      else base[key] = v && typeof v === 'object' && !Array.isArray(v) ? { name: k, ...(v as Record<string, unknown>) } : v
    }
    patch.projects = base
  }
  const { options, invalid } = parseOptions({ ...stored, ...patch })
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Check: ${invalid.join(', ')}.`, fields: invalid }, { status: 400 })
  }

  let templateName = row.welcome_template_name as string | null
  let templateLanguage = row.welcome_template_language as string | null
  if (b.welcome_template !== undefined) {
    const t = b.welcome_template as Record<string, unknown> | null
    if (t === null) {
      templateName = null
      templateLanguage = null
    } else if (typeof t === 'object' && typeof t.name === 'string' && t.name.trim()) {
      templateName = t.name.trim().slice(0, 512)
      templateLanguage = typeof t.language === 'string' && t.language.trim() ? t.language.trim().slice(0, 20) : null
      const { data: found } = await db
        .from('message_templates')
        .select('language')
        .eq('account_id', integration.account_id)
        .eq('name', templateName)
      const rows = (found ?? []) as { language: string | null }[]
      const match = rows.find((r) => !templateLanguage || r.language === templateLanguage)
      if (!match) {
        return NextResponse.json(
          { error: 'No template with that name (and language) in this Whatspert workspace.', field: 'welcome_template' },
          { status: 400 },
        )
      }
      templateLanguage = templateLanguage ?? match.language
    } else {
      return NextResponse.json(
        { error: 'welcome_template must be { name, language? } or null.', field: 'welcome_template' },
        { status: 400 },
      )
    }
  }

  if (Object.keys(patch).length > 0 || b.welcome_template !== undefined) {
    const { error: upErr } = await db
      .from('crm_integrations')
      .update({
        options,
        welcome_template_name: templateName,
        welcome_template_language: templateName ? templateLanguage : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)
    if (upErr) return NextResponse.json({ error: 'Could not save the settings.' }, { status: 500 })
    await assignTagsToGroup(db, integration.account_id, projectTagNames(options.projects), PROJECT_TAG_GROUP).catch(
      (err) => console.error('[partner settings] could not group project tags:', err),
    )
  }

  return NextResponse.json({
    greeting_by: options.greeting_by,
    welcome_template: templateName ? { name: templateName, language: templateLanguage } : null,
    source_tags: options.source_tags,
    projects: options.projects,
    fallback_welcome: options.fallback_welcome,
  })
}
