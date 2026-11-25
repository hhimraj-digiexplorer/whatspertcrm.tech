import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateLeadToken, hashLeadToken, LEAD_HOOK_COLUMNS, parseLeadHookInput, presentHook } from '@/lib/leads/hooks'

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/lead-webhooks/{id} (admin) — settings, or { rotate: true } for a new URL. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`lead-hooks:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
    const { value, errors } = parseLeadHookInput(body, true)
    if (errors.length > 0) return NextResponse.json({ error: `Check: ${errors.join(', ')}.`, fields: errors }, { status: 400 })
    const db = supabaseAdmin()
    if (value.default_project_id) {
      const { data: p } = await db.from('projects').select('id').eq('id', value.default_project_id).eq('account_id', ctx.accountId).maybeSingle()
      if (!p) return NextResponse.json({ error: 'Pick a project from this workspace.', fields: ['default_project_id'] }, { status: 400 })
    }
    const patch: Record<string, unknown> = { ...value, updated_at: new Date().toISOString() }
    if (body.rotate === true) {
      const token = generateLeadToken()
      patch.token_hash = hashLeadToken(token)
      patch.token_enc = encrypt(token)
    }
    const { data, error } = await db
      .from('lead_webhooks')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(`${LEAD_HOOK_COLUMNS}, token_enc`)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ lead_source: presentHook(data as Record<string, unknown>) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const { data, error } = await supabaseAdmin()
      .from('lead_webhooks')
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
