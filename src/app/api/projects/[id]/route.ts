import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseProjectInput } from '@/lib/projects/match'
import { ensureProjectTag, loadProjects } from '@/lib/projects/store'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/projects/{id} (admin). Changing the tag does not retag
 * contacts: the old tag stays on them (and in the "Project" group), so
 * no running flow or automation is disturbed.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`projects:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
    const { value, errors } = parseProjectInput(body, true)
    if (errors.length > 0) {
      return NextResponse.json({ error: `Check: ${errors.join(', ')}.`, fields: errors }, { status: 400 })
    }
    const db = supabaseAdmin()
    const { data, error } = await db
      .from('projects')
      .update({ ...value, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Another project already uses that tag or code.', fields: ['tag', 'code'] }, { status: 409 })
      }
      throw error
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const project = (await loadProjects(db, ctx.accountId)).find((p) => p.id === id)
    if (project && value.tag) await ensureProjectTag(db, ctx.accountId, ctx.userId, project)
    return NextResponse.json({ project })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** DELETE /api/projects/{id} (admin). The project's tag stays on contacts. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
