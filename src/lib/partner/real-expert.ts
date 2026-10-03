// ============================================================
// Real Expert CRM ⇄ Whatspert partner channel.
//
// Real Expert sells Whatspert as a WhatsApp add-on. Its server calls
// /api/partner/real-expert/* with requests signed by a shared secret
// (REAL_EXPERT_PARTNER_SECRET here, WHATSPERT_PARTNER_SECRET there):
//
//   X-Partner-Timestamp: <unix seconds>
//   X-Partner-Signature: hex HMAC-SHA256(secret, "<timestamp>.<raw body>")
//
// Single sign-on uses a short-lived token in the URL:
//   base64url(JSON payload) + "." + hex HMAC-SHA256(secret, "sso." + base64url part)
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { accessBlock, type AccountBilling } from '@/lib/billing/plans'

/** Signed requests older/newer than this are refused (replay window). */
export const MAX_SKEW_SECONDS = 300

export class PartnerConfigError extends Error {}

export function partnerSecret(): string {
  const s = process.env.REAL_EXPERT_PARTNER_SECRET?.trim()
  if (!s || s.length < 32) throw new PartnerConfigError('REAL_EXPERT_PARTNER_SECRET is not set (min 32 chars)')
  return s
}

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signPartnerBody(secret: string, timestamp: number, rawBody: string): string {
  return hmacHex(secret, `${timestamp}.${rawBody}`)
}

/**
 * Check a partner request's signature and freshness. Returns the
 * parsed JSON body, or a reason it was refused.
 */
export function verifyPartnerRequest(
  secret: string,
  headers: Headers,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true; body: Record<string, unknown> } | { ok: false; reason: 'signature' | 'expired' | 'body' } {
  const ts = Number(headers.get('x-partner-timestamp'))
  const sig = (headers.get('x-partner-signature') ?? '').trim().toLowerCase()
  if (!Number.isFinite(ts) || !sig) return { ok: false, reason: 'signature' }
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: 'expired' }
  if (!safeEqualHex(sig, signPartnerBody(secret, ts, rawBody))) return { ok: false, reason: 'signature' }
  try {
    const body = JSON.parse(rawBody) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'body' }
    return { ok: true, body: body as Record<string, unknown> }
  } catch {
    return { ok: false, reason: 'body' }
  }
}

// ------------------------------------------------------------
// Single sign-on tokens
// ------------------------------------------------------------

export interface SsoPayload {
  /** partner_ref of the linked workspace. */
  ref: string
  email: string
  name?: string
  /** Real Expert role; "admin" maps to Whatspert admin, anything else to agent. */
  role?: string
  /** Where to land, a relative path like "/inbox". */
  path?: string
  /** Opened inside Real Expert's iframe. */
  embed?: boolean
  /** Expiry, unix seconds. */
  exp: number
}

export function signSsoToken(secret: string, payload: SsoPayload): string {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${part}.${hmacHex(secret, `sso.${part}`)}`
}

export function verifySsoToken(
  secret: string,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SsoPayload | null {
  const [part, sig] = token.split('.')
  if (!part || !sig || !safeEqualHex(sig.toLowerCase(), hmacHex(secret, `sso.${part}`))) return null
  try {
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as SsoPayload
    if (typeof p.ref !== 'string' || typeof p.email !== 'string' || typeof p.exp !== 'number') return null
    // Tokens are minted per click; a long expiry would make a leaked URL a login.
    if (p.exp < nowSeconds || p.exp > nowSeconds + 600) return null
    return p
  } catch {
    return null
  }
}

/** Only same-site relative paths; anything else lands on /inbox. */
export function safeLandingPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return '/inbox'
  }
  return path.slice(0, 300)
}

export function mapRole(role: unknown): 'admin' | 'agent' {
  return role === 'admin' || role === 'owner' ? 'admin' : 'agent'
}

/** "re:<host>:<tenant>" — Real Expert's id for one client workspace. */
export function isValidPartnerRef(ref: unknown): ref is string {
  return typeof ref === 'string' && /^re:[a-z0-9.-]{1,120}:[A-Za-z0-9_-]{1,40}$/.test(ref)
}

// ------------------------------------------------------------
// Entitlement: the add-on works only when both are paid.
// ------------------------------------------------------------

export type LockReason = 'crm_unpaid' | 'whatsapp_unpaid' | null

export interface Entitlement {
  crm_paid: boolean
  whatsapp_paid: boolean
  entitled: boolean
  reason: LockReason
  whatsapp_plan: { id: string; name: string; status: string } | null
}

type BillingWithPlan = Pick<
  AccountBilling,
  'status' | 'trial_ends_at' | 'current_period_end' | 'suspended_at' | 'plan_id'
> & { plans?: { name: string; is_trial: boolean } | { name: string; is_trial: boolean }[] | null }

/** Same rule as SQL crm_whatsapp_paid(): a paid, usable, non-trial plan. */
export function whatsappPaid(billing: BillingWithPlan | null, now = new Date()): boolean {
  if (!billing) return false
  const plan = Array.isArray(billing.plans) ? billing.plans[0] : billing.plans
  if (!plan || plan.is_trial) return false
  if (billing.status === 'trialing' || billing.status === 'expired') return false
  return accessBlock(billing, now) === null
}

export function entitlementFrom(crmPaid: boolean, billing: BillingWithPlan | null, now = new Date()): Entitlement {
  const paid = whatsappPaid(billing, now)
  const plan = billing ? (Array.isArray(billing.plans) ? billing.plans[0] : billing.plans) : null
  return {
    crm_paid: crmPaid,
    whatsapp_paid: paid,
    entitled: crmPaid && paid,
    reason: !crmPaid ? 'crm_unpaid' : !paid ? 'whatsapp_unpaid' : null,
    whatsapp_plan: billing && plan ? { id: billing.plan_id, name: plan.name, status: billing.status } : null,
  }
}

export async function loadEntitlement(
  db: SupabaseClient,
  accountId: string,
  crmPaid: boolean,
): Promise<Entitlement> {
  const { data } = await db
    .from('account_billing')
    .select('plan_id, status, trial_ends_at, current_period_end, suspended_at, plans(name, is_trial)')
    .eq('account_id', accountId)
    .maybeSingle()
  return entitlementFrom(crmPaid, (data as BillingWithPlan | null) ?? null)
}
