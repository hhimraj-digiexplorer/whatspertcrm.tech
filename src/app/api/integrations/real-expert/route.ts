import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  REAL_EXPERT_PROVIDER,
  normalizeBaseUrl,
  parseOptions,
} from '@/lib/integrations/real-expert/config'
import { loadEntitlement } from '@/lib/partner/real-expert'
import {
  generateInboundToken,
  inboundPath,
  maskSecret,
} from '@/lib/integrations/real-expert/settings'

/**
 * /api/integrations/real-expert — the account's Real Expert CRM link.
 *   GET    settings (API key masked), inbound URL + token, queue stats
 *   PUT    create or update; `rotate_token: true` issues a new inbound token
 *   DELETE disconnect (drops the queue and lead links too)
 * Admin only: the row holds CRM credentials.
 */

const SELECT =
  'id, partner_ref, partner_crm_active, partner_crm_plan, is_active, base_url, api_key, inbound_token, sync_new_leads, sync_deals, sync_messages, inbound_enabled, welcome_template_name, welcome_template_language, options, last_sync_at, last_error, last_error_at, created_at'

type Row = {
  id: string
  partner_ref: string | null
  partner_crm_active: boolean
  partner_crm_plan: string | null
  is_active: boolean
  base_url: string
  api_key: string
  inbound_token: string
  sync_new_leads: boolean
  sync_deals: boolean
  sync_messages: boolean
  inbound_enabled: boolean
  welcome_template_name: string | null
  welcome_template_language: string | null
  options: unknown
  last_sync_at: string | null
  last_error: string | null
  last_error_at: string | null
}

function safeDecrypt(v: string): string | null {
  try {
    return decrypt(v)
  } catch {
    return null
  }
}

async function present(row: Row, accountId: string) {
  const admin = supabaseAdmin()
  const count = async (status: string) => {
    const { count } = await admin
      .from('crm_sync_queue')
      .select('id', { count: 'exact', head: true })
      .eq('integration_id', row.id)
      .eq('account_id', accountId)
      .eq('status', status)
    return count ?? 0
  }
  const [pending, failed, done, linked] = await Promise.all([
    count('pending'),
    count('failed'),
    count('done'),
    admin
      .from('crm_contact_links')
      .select('contact_id', { count: 'exact', head: true })
      .eq('integration_id', row.id)
      .then((r) => r.count ?? 0),
  ])
  const apiKey = safeDecrypt(row.api_key)
  const entitlement = await loadEntitlement(admin, accountId, row.partner_crm_active)
  return {
    id: row.id,
    partner_managed: !!row.partner_ref,
    partner_crm_plan: row.partner_crm_plan,
    entitlement: row.partner_ref ? entitlement : { ...entitlement, entitled: false, reason: 'crm_unpaid' as const },
    is_active: row.is_active,
    base_url: row.base_url,
    api_key_hint: apiKey ? maskSecret(apiKey) : null,
    sync_new_leads: row.sync_new_leads,
    sync_deals: row.sync_deals,
    sync_messages: row.sync_messages,
    inbound_enabled: row.inbound_enabled,
    welcome_template_name: row.welcome_template_name,
    welcome_template_language: row.welcome_template_language,
    options: parseOptions(row.options).options,
    last_sync_at: row.last_sync_at,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
    inbound_path: inboundPath(row.id),
    inbound_token: safeDecrypt(row.inbound_token),
    stats: { pending, failed, synced: done, linked_contacts: linked },
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const { data, error } = await ctx.supabase
      .from('crm_integrations')
      .select(SELECT)
      .eq('account_id', ctx.accountId)
      .eq('provider', REAL_EXPERT_PROVIDER)
      .maybeSingle()
    if (error) throw error
    if (data) return NextResponse.json({ integration: await present(data as Row, ctx.accountId) })
    // Not linked: the page shows the add-on as locked, with what is missing.
    const entitlement = await loadEntitlement(supabaseAdmin(), ctx.accountId, false)
    return NextResponse.json({ integration: null, entitlement })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`crm-settings:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const { data: existing, error: loadErr } = await ctx.supabase
      .from('crm_integrations')
      .select(SELECT)
      .eq('account_id', ctx.accountId)
      .eq('provider', REAL_EXPERT_PROVIDER)
      .maybeSingle()
    if (loadErr) throw loadErr
    const prev = existing as Row | null
    // Real Expert is an add-on: the connection is created from Real
    // Expert (partner link), never by hand here.
    if (!prev) {
      return NextResponse.json(
        { error: 'Switch on the WhatsApp add-on in Real Expert CRM to connect it.', code: 'partner_only' },
        { status: 403 },
      )
    }

    // Partner-managed: Real Expert owns the address and the key (it sets
    // them when it links the workspace). Editing them here would let the
    // sync send the Real Expert key and lead data to any host.
    const partnerManaged = !!prev.partner_ref
    const baseUrl = partnerManaged
      ? prev.base_url
      : normalizeBaseUrl(
          typeof body.base_url === 'string' ? body.base_url : prev.base_url,
          process.env.NODE_ENV !== 'production',
        )
    if (!baseUrl) {
      return NextResponse.json(
        { error: 'Enter the Real Expert address, starting with https://', field: 'base_url' },
        { status: 400 },
      )
    }

    const newKey = partnerManaged ? null : text(body.api_key, 500)

    // Merge over what is stored, so a client that sends only some options
    // (or one that predates source_tags / greeting_by) keeps the rest.
    const submitted = body.options && typeof body.options === 'object' ? (body.options as Record<string, unknown>) : {}
    const { options, invalid } = parseOptions({ ...parseOptions(prev.options).options, ...submitted })
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Check these advanced settings: ${invalid.join(', ')}.`, field: 'options' },
        { status: 400 },
      )
    }

    const inboundEnabled = bool(body.inbound_enabled, prev?.inbound_enabled ?? false)
    const templateName =
      body.welcome_template_name === undefined ? prev?.welcome_template_name ?? null : text(body.welcome_template_name, 512)
    const templateLanguage =
      body.welcome_template_language === undefined
        ? prev?.welcome_template_language ?? null
        : text(body.welcome_template_language, 20)
    const now = new Date().toISOString()
    const row: Record<string, unknown> = {
      account_id: ctx.accountId,
      provider: REAL_EXPERT_PROVIDER,
      is_active: bool(body.is_active, prev?.is_active ?? true),
      base_url: baseUrl,
      sync_new_leads: bool(body.sync_new_leads, prev?.sync_new_leads ?? true),
      sync_deals: bool(body.sync_deals, prev?.sync_deals ?? true),
      sync_messages: bool(body.sync_messages, prev?.sync_messages ?? false),
      inbound_enabled: inboundEnabled,
      welcome_template_name: templateName,
      welcome_template_language: templateName ? templateLanguage : null,
      options,
      updated_at: now,
    }
    if (newKey) row.api_key = encrypt(newKey)
    if (body.rotate_token === true) row.inbound_token = encrypt(generateInboundToken())
    // A changed address or key deserves a fresh start on the error banner.
    if (newKey || baseUrl !== prev?.base_url) {
      row.last_error = null
      row.last_error_at = null
    }

    // Update, never upsert: the row always exists here (connections are
    // created from Real Expert), and an upsert's INSERT half is checked
    // against NOT NULL columns (api_key, inbound_token) before the
    // conflict is resolved, so it failed every save that didn't carry a
    // new API key — i.e. every save on a partner-managed connection.
    delete row.account_id
    delete row.provider
    const { data: saved, error: saveErr } = await ctx.supabase
      .from('crm_integrations')
      .update(row)
      .eq('id', prev.id)
      .eq('account_id', ctx.accountId)
      .select(SELECT)
      .single()
    if (saveErr) throw saveErr

    // Jobs that failed for a bad address/key get another go.
    if (prev && (newKey || baseUrl !== prev.base_url)) {
      await supabaseAdmin()
        .from('crm_sync_queue')
        .update({ status: 'pending', attempts: 0, next_attempt_at: now, updated_at: now })
        .eq('integration_id', prev.id)
        .eq('status', 'failed')
        .then(
          () => undefined,
          () => undefined,
        )
    }

    return NextResponse.json({ integration: await present(saved as Row, ctx.accountId) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const { data: row } = await ctx.supabase
      .from('crm_integrations')
      .select('partner_ref')
      .eq('account_id', ctx.accountId)
      .eq('provider', REAL_EXPERT_PROVIDER)
      .maybeSingle()
    if (row?.partner_ref) {
      return NextResponse.json(
        { error: 'This connection is managed by Real Expert CRM. Switch the add-on off there.', code: 'partner_managed' },
        { status: 403 },
      )
    }
    const { error } = await ctx.supabase
      .from('crm_integrations')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('provider', REAL_EXPERT_PROVIDER)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
