import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claimed: null as Record<string, unknown> | null,
  saved: [] as Record<string, unknown>[],
  numbers: [{ id: '111', display_phone_number: '+91 90000 00000', verified_name: 'Shop' }],
  register: vi.fn(),
  subscribe: vi.fn(),
  exchange: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/account')>()),
  requireRole: async () => ({
    userId: 'u1',
    accountId: 'acc1',
    role: 'admin',
    account: { id: 'acc1', name: 'Acc' },
    supabase: {
      from: () => ({
        upsert: async (row: Record<string, unknown>) => {
          h.saved.push(row)
          return { error: null }
        },
      }),
    },
  }),
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ neq: () => ({ maybeSingle: async () => ({ data: h.claimed, error: null }) }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (v: string) => `enc(${v})` }))
vi.mock('@/lib/whatsapp/embedded-signup', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/embedded-signup')>()),
  exchangeCodeForToken: h.exchange,
  generateTwoStepPin: () => '123456',
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  listWabaPhoneNumbers: async () => h.numbers,
  registerPhoneNumber: h.register,
  subscribeWabaToApp: h.subscribe,
  verifyPhoneNumber: async () => ({ id: '111', display_phone_number: '+91 90000 00000' }),
}))

import { POST } from './route'

const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

const BODY = { code: 'c0de', phone_number_id: '111', waba_id: '222' }

beforeEach(() => {
  h.claimed = null
  h.saved = []
  h.register.mockReset().mockResolvedValue({})
  h.subscribe.mockReset().mockResolvedValue(undefined)
  h.exchange.mockReset().mockResolvedValue('biz-token')
})

describe('POST /api/whatsapp/embedded-signup', () => {
  it('connects the number: subscribe, register with a PIN, save encrypted', async () => {
    const res = await call(BODY)
    expect(res.status).toBe(200)
    expect(h.subscribe).toHaveBeenCalledWith({ wabaId: '222', accessToken: 'biz-token' })
    expect(h.register).toHaveBeenCalledWith({ phoneNumberId: '111', accessToken: 'biz-token', pin: '123456' })
    expect(h.saved[0]).toMatchObject({
      account_id: 'acc1',
      phone_number_id: '111',
      waba_id: '222',
      access_token: 'enc(biz-token)',
      two_step_pin: 'enc(123456)',
      onboarding_method: 'embedded',
      status: 'connected',
    })
  })

  it('does not re-register WhatsApp Business app (coexistence) numbers', async () => {
    await call({ ...BODY, coexistence: true })
    expect(h.register).not.toHaveBeenCalled()
    expect(h.saved[0]).toMatchObject({ onboarding_method: 'coexistence', two_step_pin: null })
  })

  it('refuses a number another account already uses', async () => {
    h.claimed = { account_id: 'other' }
    expect((await call(BODY)).status).toBe(409)
    expect(h.exchange).not.toHaveBeenCalled()
  })

  it('rejects a number outside the chosen WABA', async () => {
    h.numbers = [{ id: '999', display_phone_number: 'x', verified_name: 'y' }]
    expect((await call(BODY)).status).toBe(400)
    expect(h.saved).toHaveLength(0)
    h.numbers = [{ id: '111', display_phone_number: '+91 90000 00000', verified_name: 'Shop' }]
  })

  it('saves but reports a failed registration so the client can retry', async () => {
    h.register.mockRejectedValue(new Error('PIN mismatch'))
    const body = await (await call(BODY)).json()
    expect(body.success).toBe(false)
    expect(h.saved[0]).toMatchObject({ status: 'disconnected', two_step_pin: null })
  })

  it('400s on missing ids and when Meta rejects the code', async () => {
    expect((await call({ code: 'x' })).status).toBe(400)
    h.exchange.mockRejectedValue(new Error('bad code'))
    expect((await call(BODY)).status).toBe(400)
  })
})
