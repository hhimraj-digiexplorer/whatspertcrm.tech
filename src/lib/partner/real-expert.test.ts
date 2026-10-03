import { describe, expect, it } from 'vitest'
import {
  entitlementFrom,
  isValidPartnerRef,
  mapRole,
  safeLandingPath,
  signPartnerBody,
  signSsoToken,
  verifyPartnerRequest,
  verifySsoToken,
  whatsappPaid,
} from './real-expert'

const SECRET = 'x'.repeat(40)
const NOW = 1_800_000_000

function headers(ts: number, sig: string) {
  return new Headers({ 'x-partner-timestamp': String(ts), 'x-partner-signature': sig })
}

describe('verifyPartnerRequest', () => {
  const body = JSON.stringify({ ref: 're:crm.example.in:7' })
  it('accepts a correctly signed, fresh request', () => {
    const r = verifyPartnerRequest(SECRET, headers(NOW, signPartnerBody(SECRET, NOW, body)), body, NOW)
    expect(r).toEqual({ ok: true, body: { ref: 're:crm.example.in:7' } })
  })
  it('rejects a wrong signature, a tampered body and a stale timestamp', () => {
    expect(verifyPartnerRequest(SECRET, headers(NOW, 'abc'), body, NOW)).toMatchObject({ ok: false, reason: 'signature' })
    const sig = signPartnerBody(SECRET, NOW, body)
    expect(verifyPartnerRequest(SECRET, headers(NOW, sig), body.replace('7', '8'), NOW)).toMatchObject({ ok: false })
    expect(verifyPartnerRequest(SECRET, headers(NOW - 600, signPartnerBody(SECRET, NOW - 600, body)), body, NOW)).toMatchObject({
      ok: false,
      reason: 'expired',
    })
    expect(verifyPartnerRequest(SECRET, new Headers(), body, NOW)).toMatchObject({ ok: false })
  })
})

describe('SSO tokens', () => {
  const payload = { ref: 're:crm.example.in:7', email: 'a@b.in', role: 'admin', path: '/inbox', exp: NOW + 120 }
  it('round-trips', () => {
    expect(verifySsoToken(SECRET, signSsoToken(SECRET, payload), NOW)).toMatchObject(payload)
  })
  it('rejects tampering, expiry and over-long lifetimes', () => {
    const t = signSsoToken(SECRET, payload)
    const [, sig] = t.split('.')
    const forged = `${Buffer.from(JSON.stringify({ ...payload, email: 'evil@x.in' })).toString('base64url')}.${sig}`
    expect(verifySsoToken(SECRET, forged, NOW)).toBeNull()
    expect(verifySsoToken(SECRET, t, NOW + 121)).toBeNull()
    expect(verifySsoToken(SECRET, signSsoToken(SECRET, { ...payload, exp: NOW + 3600 }), NOW)).toBeNull()
    expect(verifySsoToken('y'.repeat(40), t, NOW)).toBeNull()
    expect(verifySsoToken(SECRET, 'garbage', NOW)).toBeNull()
  })
})

describe('helpers', () => {
  it('keeps landing paths on this site', () => {
    expect(safeLandingPath('/inbox?c=1')).toBe('/inbox?c=1')
    expect(safeLandingPath('//evil.com')).toBe('/inbox')
    expect(safeLandingPath('https://evil.com')).toBe('/inbox')
    expect(safeLandingPath(undefined)).toBe('/inbox')
  })
  it('maps roles', () => {
    expect(mapRole('admin')).toBe('admin')
    expect(mapRole('listing_agent')).toBe('agent')
    expect(mapRole(undefined)).toBe('agent')
  })
  it('validates partner refs', () => {
    expect(isValidPartnerRef('re:crm.digiexplorer.in:42')).toBe(true)
    expect(isValidPartnerRef('re:crm.digiexplorer.in')).toBe(false)
    expect(isValidPartnerRef('x:a:1')).toBe(false)
    expect(isValidPartnerRef(42)).toBe(false)
  })
})

describe('entitlement', () => {
  const now = new Date('2026-10-03T00:00:00Z')
  const paid = {
    plan_id: 'growth',
    status: 'active' as const,
    trial_ends_at: null,
    current_period_end: '2026-11-01T00:00:00Z',
    suspended_at: null,
    plans: { name: 'Growth', is_trial: false },
  }
  it('needs a paid, usable, non-trial WhatsApp plan', () => {
    expect(whatsappPaid(paid, now)).toBe(true)
    expect(whatsappPaid({ ...paid, plan_id: 'trial', status: 'trialing', plans: { name: 'Free trial', is_trial: true } }, now)).toBe(false)
    expect(whatsappPaid({ ...paid, suspended_at: '2026-10-01T00:00:00Z' }, now)).toBe(false)
    expect(whatsappPaid({ ...paid, status: 'cancelled', current_period_end: '2026-09-01T00:00:00Z' }, now)).toBe(false)
    expect(whatsappPaid(null, now)).toBe(false)
  })
  it('unlocks only when both are paid, and says what is missing', () => {
    expect(entitlementFrom(true, paid, now)).toMatchObject({ entitled: true, reason: null })
    expect(entitlementFrom(false, paid, now)).toMatchObject({ entitled: false, reason: 'crm_unpaid' })
    expect(entitlementFrom(true, null, now)).toMatchObject({ entitled: false, reason: 'whatsapp_unpaid' })
  })
})
