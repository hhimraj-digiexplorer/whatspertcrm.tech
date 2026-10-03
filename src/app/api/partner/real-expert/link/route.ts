import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { REAL_EXPERT_PROVIDER, normalizeBaseUrl } from '@/lib/integrations/real-expert/config'
import { generateInboundToken, inboundPath } from '@/lib/integrations/real-expert/settings'
import { loadEntitlement } from '@/lib/partner/real-expert'
import { findPartnerIntegration, readPartnerRequest, siteOrigin } from '@/lib/partner/server'

/**
 * POST /api/partner/real-expert/link  (signed, server-to-server)
 *
 * Real Expert calls this when a client switches on the WhatsApp add-on.
 * It finds or creates the client's Whatspert account and connects the
 * Real Expert sync automatically (no manual setup):
 *
 *   - already linked (same ref)        → refresh the CRM address/key;
 *   - `link_code` from Whatspert        → link that existing account;
 *   - otherwise                         → create a new account owned by
 *                                         `owner_email` (refused if that
 *                                         email already uses Whatspert —
 *                                         they must use a link code).
 *
 * Body: { ref, tenant_name, owner_email, owner_name?, crm_base_url,
 *         crm_api_key, crm_active, crm_plan?, link_code? }
 * Returns the inbound webhook URL + token for Real Expert to register,
 * and the entitlement.
 */
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const read = await readPartnerRequest(request)
  if (read instanceof NextResponse) return read
  const b = read.body
  const ref = b.ref as string
  const db = supabaseAdmin()

  const baseUrl = normalizeBaseUrl(String(b.crm_base_url ?? ''), process.env.NODE_ENV !== 'production')
  if (!baseUrl) return NextResponse.json({ error: 'crm_base_url must be an https URL.' }, { status: 400 })
  const apiKey = str(b.crm_api_key, 500)
  const crmActive = b.crm_active === true
  const crmPlan = str(b.crm_plan, 60)

  let accountId: string
  const existing = await findPartnerIntegration(db, ref)
  if (existing) {
    accountId = existing.account_id
  } else if (str(b.link_code, 40)) {
    const hash = createHash('sha256').update(String(b.link_code).trim().toUpperCase()).digest('hex')
    const { data: code } = await db
      .from('partner_link_codes')
      .select('account_id, expires_at, used_at')
      .eq('code_hash', hash)
      .maybeSingle()
    if (!code || code.used_at || new Date(code.expires_at as string) < new Date()) {
      return NextResponse.json({ error: 'The link code is wrong or has expired.', code: 'bad_link_code' }, { status: 400 })
    }
    const { data: other } = await db
      .from('crm_integrations')
      .select('partner_ref')
      .eq('account_id', code.account_id)
      .not('partner_ref', 'is', null)
      .maybeSingle()
    if (other && other.partner_ref !== ref) {
      return NextResponse.json({ error: 'That Whatspert account is linked to another Real Expert workspace.', code: 'already_linked' }, { status: 409 })
    }
    await db.from('partner_link_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', hash)
    accountId = code.account_id as string
  } else {
    const email = str(b.owner_email, 200)?.toLowerCase()
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'owner_email is required.' }, { status: 400 })
    }
    const { data: taken } = await db.from('profiles').select('user_id').ilike('email', email).limit(1).maybeSingle()
    if (taken) {
      return NextResponse.json(
        {
          error: 'This email already has a Whatspert account. Create a link code in Whatspert → Integrations and enter it here.',
          code: 'email_in_use',
        },
        { status: 409 },
      )
    }
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: str(b.owner_name, 120) ?? '' },
    })
    if (createErr || !created.user) {
      console.error('[partner/link] createUser failed:', createErr)
      return NextResponse.json({ error: 'Could not create the Whatspert account.' }, { status: 500 })
    }
    const { data: profile } = await db
      .from('profiles')
      .select('account_id')
      .eq('user_id', created.user.id)
      .maybeSingle()
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Could not create the Whatspert account.' }, { status: 500 })
    }
    accountId = profile.account_id as string
    const tenantName = str(b.tenant_name, 120)
    if (tenantName) await db.from('accounts').update({ name: tenantName }).eq('id', accountId)
  }

  // Connect the sync. Keep an existing inbound token so Real Expert's
  // webhook keeps working across re-links.
  const { data: current } = await db
    .from('crm_integrations')
    .select('id, inbound_token, api_key')
    .eq('account_id', accountId)
    .eq('provider', REAL_EXPERT_PROVIDER)
    .maybeSingle()
  if (!current && !apiKey) {
    return NextResponse.json({ error: 'crm_api_key is required.' }, { status: 400 })
  }

  let inboundToken: string | null = null
  if (current?.inbound_token) {
    try {
      inboundToken = decrypt(current.inbound_token as string)
    } catch {
      inboundToken = null
    }
  }
  if (!inboundToken) inboundToken = generateInboundToken()

  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    account_id: accountId,
    provider: REAL_EXPERT_PROVIDER,
    partner_ref: ref,
    partner_crm_active: crmActive,
    partner_crm_plan: crmPlan,
    partner_synced_at: now,
    base_url: baseUrl,
    inbound_token: encrypt(inboundToken),
    is_active: true,
    updated_at: now,
  }
  if (apiKey) row.api_key = encrypt(apiKey)
  if (!current) {
    Object.assign(row, {
      sync_new_leads: true,
      sync_deals: true,
      sync_messages: true,
      inbound_enabled: true,
      options: { auth_style: 'bearer' },
    })
  }
  const { data: saved, error: saveErr } = await db
    .from('crm_integrations')
    .upsert(row, { onConflict: 'account_id,provider' })
    .select('id')
    .single()
  if (saveErr || !saved) {
    console.error('[partner/link] save failed:', saveErr)
    return NextResponse.json({ error: 'Could not save the link.' }, { status: 500 })
  }

  const [entitlement, { data: wa }] = await Promise.all([
    loadEntitlement(db, accountId, crmActive),
    db.from('whatsapp_config').select('status').eq('account_id', accountId).maybeSingle(),
  ])

  return NextResponse.json({
    account_id: accountId,
    integration_id: saved.id,
    inbound_url: `${siteOrigin(request)}${inboundPath(saved.id as string)}`,
    inbound_token: inboundToken,
    whatsapp_connected: wa?.status === 'connected',
    entitlement,
  })
}
