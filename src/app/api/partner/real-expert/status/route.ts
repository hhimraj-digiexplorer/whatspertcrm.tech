import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadEntitlement } from '@/lib/partner/real-expert'
import { findPartnerIntegration, readPartnerRequest } from '@/lib/partner/server'

/**
 * POST /api/partner/real-expert/status  (signed)
 * Body: { ref, crm_active, crm_plan? }
 *
 * Real Expert reports whether the client's CRM subscription is paid
 * (on every billing change, and before showing the WhatsApp pages) and
 * gets back whether the add-on is unlocked, plus the WhatsApp plans to
 * offer when it is not.
 */
export async function POST(request: Request) {
  const read = await readPartnerRequest(request)
  if (read instanceof NextResponse) return read
  const b = read.body
  const db = supabaseAdmin()

  const integration = await findPartnerIntegration(db, b.ref as string)
  if (!integration) return NextResponse.json({ linked: false })

  const crmActive = typeof b.crm_active === 'boolean' ? b.crm_active : integration.partner_crm_active
  if (crmActive !== integration.partner_crm_active || typeof b.crm_plan === 'string') {
    await db
      .from('crm_integrations')
      .update({
        partner_crm_active: crmActive,
        partner_crm_plan: typeof b.crm_plan === 'string' ? b.crm_plan.slice(0, 60) : integration.partner_crm_plan,
        partner_synced_at: new Date().toISOString(),
      })
      .eq('id', integration.id)
  }

  const [entitlement, { data: wa }, { data: plans }] = await Promise.all([
    loadEntitlement(db, integration.account_id, crmActive),
    db.from('whatsapp_config').select('status').eq('account_id', integration.account_id).maybeSingle(),
    db
      .from('plans')
      .select('id, name, price_monthly_inr, price_yearly_inr, features')
      .eq('is_public', true)
      .eq('is_trial', false)
      .order('sort_order'),
  ])

  return NextResponse.json({
    linked: true,
    account_id: integration.account_id,
    whatsapp_connected: wa?.status === 'connected',
    entitlement,
    whatsapp_plans: plans ?? [],
  })
}
