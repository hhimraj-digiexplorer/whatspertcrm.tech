import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseProjectInput } from '@/lib/projects/match'
import { ensureProjectTag, loadProjects, PROJECT_COLUMNS } from '@/lib/projects/store'

/** GET /api/projects — the workspace's projects (any member). */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    return NextResponse.json({ projects: await loadProjects(ctx.supabase, ctx.accountId) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

const MAX_PROJECTS_PER_ACCOUNT = 100

/**
 * POST /api/projects (admin) — create a project. Its tag is created in
 * the "Project" tag group right away, so flows and automations can use it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`projects:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
    const { value, errors } = parseProjectInput(body)
    if (errors.length > 0) {
      return NextResponse.json({ error: `Check: ${errors.join(', ')}.`, fields: errors }, { status: 400 })
    }
    const db = supabaseAdmin()
    const { count } = await db
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    if ((count ?? 0) >= MAX_PROJECTS_PER_ACCOUNT) {
      return NextResponse.json({ error: `Up to ${MAX_PROJECTS_PER_ACCOUNT} projects per workspace.` }, { status: 400 })
    }
    const { data, error } = await db
      .from('projects')
      .insert({ ...value, account_id: ctx.accountId, created_by: ctx.userId })
      .select(PROJECT_COLUMNS)
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Another project already uses that tag or code.', fields: ['tag', 'code'] }, { status: 409 })
      }
      throw error
    }
    const [project] = await loadProjects(db, ctx.accountId).then((all) => all.filter((p) => p.id === (data as { id: string }).id))
    if (project) await ensureProjectTag(db, ctx.accountId, ctx.userId, project)
    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
