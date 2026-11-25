import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateLeadToken, hashLeadToken, LEAD_HOOK_COLUMNS, parseLeadHookInput, presentHook } from '@/lib/leads/hooks'

const MAX_HOOKS = 25

/** GET /api/lead-webhooks (admin) — the workspace's lead sources. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const { data, error } = await supabaseAdmin()
      .from('lead_webhooks')
      .select(`${LEAD_HOOK_COLUMNS}, token_enc`)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return NextResponse.json({ lead_sources: ((data ?? []) as Record<string, unknown>[]).map(presentHook) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** POST /api/lead-webhooks (admin) — a new lead source with its own URL. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`lead-hooks:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
    const { value, errors } = parseLeadHookInput(body)
    if (errors.length > 0) return NextResponse.json({ error: `Check: ${errors.join(', ')}.`, fields: errors }, { status: 400 })
    const db = supabaseAdmin()
    const { count } = await db
      .from('lead_webhooks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    if ((count ?? 0) >= MAX_HOOKS) return NextResponse.json({ error: `Up to ${MAX_HOOKS} lead sources.` }, { status: 400 })
    if (value.default_project_id) {
      const { data: p } = await db.from('projects').select('id').eq('id', value.default_project_id).eq('account_id', ctx.accountId).maybeSingle()
      if (!p) return NextResponse.json({ error: 'Pick a project from this workspace.', fields: ['default_project_id'] }, { status: 400 })
    }
    const token = generateLeadToken()
    const { data, error } = await db
      .from('lead_webhooks')
      .insert({
        ...value,
        account_id: ctx.accountId,
        created_by: ctx.userId,
        token_hash: hashLeadToken(token),
        token_enc: encrypt(token),
      })
      .select(`${LEAD_HOOK_COLUMNS}, token_enc`)
      .single()
    if (error) throw error
    return NextResponse.json({ lead_source: presentHook(data as Record<string, unknown>) }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
