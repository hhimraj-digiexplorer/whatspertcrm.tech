import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signPartnerBody } from '@/lib/partner/real-expert'

const SECRET = 's'.repeat(40)
process.env.REAL_EXPERT_PARTNER_SECRET = SECRET
process.env.NEXT_PUBLIC_SITE_URL = 'https://whatspertcrm.tech'

const h = vi.hoisted(() => ({
  integrationByRef: null as Record<string, unknown> | null,
  /** Results of successive `profiles` lookups, in order. */
  profiles: [] as (Record<string, unknown> | null)[],
  linkCode: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
  createUser: vi.fn(),
  accountRenames: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(|\)$/g, ''),
}))

/** Chainable query stub: every filter returns itself; terminal calls resolve `result()`. */
function q(result: () => unknown, extra: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = { ...extra }
  for (const m of ['select', 'eq', 'ilike', 'not', 'is', 'limit', 'order', 'in', 'update', 'delete']) {
    if (!(m in c)) c[m] = () => c
  }
  c.maybeSingle = async () => result()
  c.single = async () => result()
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null, data: null }).then(res)
  return c
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    auth: { admin: { createUser: h.createUser } },
    from(table: string) {
      switch (table) {
        case 'crm_integrations':
          return q(() => ({ data: h.integrationByRef, error: null }), {
            upsert: (row: Record<string, unknown>) => {
              h.upserts.push(row)
              return q(() => ({ data: { id: 'int1' }, error: null }))
            },
          })
        case 'profiles':
          return q(() => ({ data: h.profiles.shift() ?? null, error: null }))
        case 'partner_link_codes':
          return q(() => ({ data: h.linkCode, error: null }))
        case 'accounts':
          return q(() => ({ data: null, error: null }), {
            update: (row: Record<string, unknown>) => {
              h.accountRenames.push(row)
              return q(() => ({ data: null, error: null }))
            },
          })
        case 'account_billing':
          return q(() => ({
            data: {
              plan_id: 'growth',
              status: 'active',
              trial_ends_at: null,
              current_period_end: '2099-01-01T00:00:00Z',
              suspended_at: null,
              plans: { name: 'Growth', is_trial: false },
            },
            error: null,
          }))
        default:
          return q(() => ({ data: null, error: null }))
      }
    },
  }),
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const REF = 're:crm.digiexplorer.in:7'

function signed(body: Record<string, unknown>) {
  const raw = JSON.stringify(body)
  const ts = Math.floor(Date.now() / 1000)
  return new Request('http://x/api/partner/real-expert/link', {
    method: 'POST',
    headers: { 'x-partner-timestamp': String(ts), 'x-partner-signature': signPartnerBody(SECRET, ts, raw) },
    body: raw,
  })
}

const BASE = {
  ref: REF,
  tenant_name: 'Gomti Realty',
  owner_email: 'owner@gomti.in',
  owner_name: 'Ravi',
  crm_base_url: 'https://crm.digiexplorer.in',
  crm_api_key: 'rk_123',
  crm_active: true,
  crm_plan: 'Pro',
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.integrationByRef = null
  h.profiles = []
  h.linkCode = null
  h.upserts = []
  h.accountRenames = []
  h.createUser.mockReset().mockResolvedValue({ data: { user: { id: 'u-new' } }, error: null })
})

describe('POST /api/partner/real-expert/link', () => {
  it('refuses unsigned requests', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(BASE) }))
    expect(res.status).toBe(401)
  })

  it('creates a new account and connects the sync automatically', async () => {
    // Is the email taken? → no. Then the new user's profile → its account.
    h.profiles = [null, { account_id: 'acc-new' }]
    const res = await POST(signed(BASE))
    expect(res.status).toBe(200)
    expect(h.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@gomti.in', email_confirm: true }))
    expect(h.accountRenames[0]).toEqual({ name: 'Gomti Realty' })
    expect(h.upserts[0]).toMatchObject({
      account_id: 'acc-new',
      partner_ref: REF,
      partner_crm_active: true,
      base_url: 'https://crm.digiexplorer.in',
      api_key: 'enc(rk_123)',
      sync_new_leads: true,
      sync_deals: true,
      sync_messages: true,
      inbound_enabled: true,
    })
    const body = await res.json()
    expect(body.inbound_url).toBe('https://whatspertcrm.tech/api/integrations/real-expert/inbound/int1')
    expect(body.inbound_token).toMatch(/^rex_/)
    expect(body.entitlement).toMatchObject({ entitled: true })
  })

  it('will not attach to an existing Whatspert user by email alone', async () => {
    h.profiles = [{ user_id: 'u1', account_id: 'acc-1' }]
    const res = await POST(signed(BASE))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'email_in_use' })
    expect(h.upserts).toHaveLength(0)
  })

  it('links an existing account with a valid link code', async () => {
    h.linkCode = { account_id: 'acc-1', expires_at: '2099-01-01T00:00:00Z', used_at: null }
    const res = await POST(signed({ ...BASE, link_code: 'k7qm-4xtb' }))
    expect(res.status).toBe(200)
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.upserts[0]).toMatchObject({ account_id: 'acc-1', partner_ref: REF })
  })

  it('rejects an expired link code', async () => {
    h.linkCode = { account_id: 'acc-1', expires_at: '2000-01-01T00:00:00Z', used_at: null }
    const res = await POST(signed({ ...BASE, link_code: 'K7QM-4XTB' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'bad_link_code' })
  })

  it('re-links an already linked workspace without creating anything', async () => {
    h.integrationByRef = { id: 'int1', account_id: 'acc-9', partner_ref: REF, partner_crm_active: false, is_active: true }
    const res = await POST(signed({ ...BASE, crm_api_key: 'rk_new' }))
    expect(res.status).toBe(200)
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.upserts[0]).toMatchObject({ account_id: 'acc-9', api_key: 'enc(rk_new)' })
  })
})

