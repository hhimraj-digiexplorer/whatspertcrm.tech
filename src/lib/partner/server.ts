// Route helpers for /api/partner/real-expert/*.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  isValidPartnerRef,
  loadEntitlement,
  PartnerConfigError,
  partnerSecret,
  verifyPartnerRequest,
  type Entitlement,
} from './real-expert'

export interface PartnerIntegration {
  id: string
  account_id: string
  partner_ref: string
  partner_crm_active: boolean
  partner_crm_plan: string | null
  is_active: boolean
}

export const PARTNER_INTEGRATION_SELECT =
  'id, account_id, partner_ref, partner_crm_active, partner_crm_plan, is_active'

/** Verify the signature and parse the body, or return the error response. */
export async function readPartnerRequest(
  request: Request,
): Promise<{ body: Record<string, unknown> } | NextResponse> {
  let secret: string
  try {
    secret = partnerSecret()
  } catch (err) {
    if (err instanceof PartnerConfigError) {
      return NextResponse.json({ error: 'Partner access is not set up on this server.' }, { status: 503 })
    }
    throw err
  }
  const raw = await request.text().catch(() => '')
  const result = verifyPartnerRequest(secret, request.headers, raw)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === 'expired' ? 'Request expired; check the server clock.' : 'Invalid signature.' },
      { status: result.reason === 'body' ? 400 : 401 },
    )
  }
  const ref = result.body.ref
  if (!isValidPartnerRef(ref)) {
    return NextResponse.json({ error: 'Missing or invalid ref.' }, { status: 400 })
  }
  const limit = checkRateLimit(`partner:${ref}`, RATE_LIMITS.publicApi)
  if (!limit.success) return rateLimitResponse(limit)
  return { body: result.body }
}

export async function findPartnerIntegration(
  db: SupabaseClient,
  ref: string,
): Promise<PartnerIntegration | null> {
  const { data } = await db
    .from('crm_integrations')
    .select(PARTNER_INTEGRATION_SELECT)
    .eq('partner_ref', ref)
    .maybeSingle()
  return (data as PartnerIntegration | null) ?? null
}

/** Load the integration and its entitlement, or a 404/403 response. */
export async function requireEntitledPartner(
  db: SupabaseClient,
  ref: string,
): Promise<{ integration: PartnerIntegration; entitlement: Entitlement } | NextResponse> {
  const integration = await findPartnerIntegration(db, ref)
  if (!integration) {
    return NextResponse.json({ error: 'This workspace is not linked to Whatspert yet.', code: 'not_linked' }, { status: 404 })
  }
  const entitlement = await loadEntitlement(db, integration.account_id, integration.partner_crm_active)
  if (!entitlement.entitled || !integration.is_active) {
    return NextResponse.json(
      {
        error: 'The WhatsApp add-on needs both a paid Real Expert plan and a paid WhatsApp plan.',
        code: entitlement.reason ?? 'inactive',
        entitlement,
      },
      { status: 403 },
    )
  }
  return { integration, entitlement }
}

/** Public origin for links handed to Real Expert. */
export function siteOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  return new URL(request.url).origin
}
