import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseOptions } from '@/lib/integrations/real-expert/config'
import { mergeProjectSettings } from '@/lib/integrations/real-expert/projects-bridge'
import { applyPartnerProjects, type PartnerProjectError } from '@/lib/projects/partner-sync'
import { loadProjects } from '@/lib/projects/store'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { findPartnerIntegration, readPartnerRequest } from '@/lib/partner/server'

/**
 * POST /api/partner/real-expert/settings  (signed)
 * Body: { ref,
 *         greeting_by?: 'whatspert' | 'real_expert',
 *         welcome_template?: { name, language? } | null,
 *         source_tags?: { [source]: tag | "" },     // "" removes one
 *         replace_source_tags?: boolean,            // default: merge
 *         projects?: { [name|code]: { name?, tag?, code?, category?, keywords?, ad_ids?, ads?,
 *                       welcome?: { template, language? } | 'none' | 'default', ai_instructions?, active? } | null },
 *         replace_projects?: boolean,               // default: merge; null removes one
 *         rename_codes?: [{ old_code, new_code }],  // applied first; project, tag, contacts unchanged
 *                                                   // (writes the workspace's Projects)
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
  // Projects now live in the workspace's Projects (Settings → Projects),
  // shared by every lead source; the integration's own copy is retired.
  let projectErrors: PartnerProjectError[] = []
  if (b.rename_codes !== undefined && !Array.isArray(b.rename_codes)) {
    return NextResponse.json({ error: 'rename_codes must be a list of { old_code, new_code }.', fields: ['rename_codes'] }, { status: 400 })
  }
  if (b.projects !== undefined || Array.isArray(b.rename_codes)) {
    if (b.projects !== undefined && (!b.projects || typeof b.projects !== 'object' || Array.isArray(b.projects))) {
      return NextResponse.json({ error: 'projects must be an object of project → settings.', fields: ['projects'] }, { status: 400 })
    }
    const auditUserId = await resolveAuditUserId(db, integration.account_id)
    const applied = await applyPartnerProjects(db, {
      accountId: integration.account_id,
      userId: auditUserId,
      projects: (b.projects ?? {}) as Record<string, unknown>,
      replace: b.projects !== undefined && b.replace_projects === true,
      renames: Array.isArray(b.rename_codes) ? (b.rename_codes as { old_code: string; new_code: string }[]) : [],
    })
    projectErrors = applied.errors
    patch.projects = {}
  }
  const { options, invalid } = parseOptions({ ...stored, ...patch })
  if (invalid.length > 0 || projectErrors.length > 0) {
    // Shown to the Real Expert admin as "Last sync failed": plain words.
    // Entries without a problem in the same call were saved.
    const messages = [...(invalid.length > 0 ? [`Check these settings: ${invalid.join(', ')}.`] : []), ...projectErrors.map((e) => e.message)]
    return NextResponse.json(
      { error: messages.join(' '), errors: projectErrors, fields: [...invalid, ...projectErrors.map((e) => e.field)] },
      { status: 400 },
    )
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
  }

  const workspaceProjects = await loadProjects(db, integration.account_id)
  return NextResponse.json({
    greeting_by: options.greeting_by,
    welcome_template: templateName ? { name: templateName, language: templateLanguage } : null,
    source_tags: options.source_tags,
    projects: mergeProjectSettings({}, workspaceProjects),
    workspace_projects: workspaceProjects,
    fallback_welcome: options.fallback_welcome,
  })
}
