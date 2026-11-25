import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claimed: null as Record<string, unknown> | null,
  saved: [] as Record<string, unknown>[],
  numbers: [{ id: '111', display_phone_number: '+91 90000 00000', verified_name: 'Shop' }] as { id: string; display_phone_number?: string; verified_name?: string }[],
  register: vi.fn(),
  subscribe: vi.fn(),
  exchange: vi.fn(),
  shared: ['222'] as string[],
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
  sharedWabaIds: async () => h.shared,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  listWabaPhoneNumbers: async () => h.numbers,
  registerPhoneNumber: h.register,
  subscribeWabaToApp: h.subscribe,
  verifyPhoneNumber: async () => ({ id: '111', display_phone_number: '+91 90000 00000' }),
}))

import { POST } from './route'

const call = (body: unknown, host = 'x') =>
  POST(new Request(`http://${host}`, { method: 'POST', headers: { host }, body: JSON.stringify(body) }))

const BODY = { code: 'c0de', phone_number_id: '111', waba_id: '222' }

beforeEach(() => {
  h.claimed = null
  h.saved = []
  h.register.mockReset().mockResolvedValue({})
  h.subscribe.mockReset().mockResolvedValue(undefined)
  h.exchange.mockReset().mockResolvedValue('biz-token')
  h.shared = ['222']
  h.numbers = [{ id: '111', display_phone_number: '+91 90000 00000', verified_name: 'Shop' }]
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

describe('POST /api/whatsapp/embedded-signup (mobile redirect flow)', () => {
  const RB = { code: 'c0de', redirect_uri: 'https://app.test/whatsapp' }

  it('exchanges with the redirect_uri and finds the shared WABA + number', async () => {
    const res = await call(RB, 'app.test')
    expect(res.status).toBe(200)
    expect(h.exchange).toHaveBeenCalledTimes(1)
    expect(h.exchange).toHaveBeenCalledWith('c0de', 'https://app.test/whatsapp')
    expect(h.saved[0]).toMatchObject({ phone_number_id: '111', waba_id: '222', status: 'connected' })
  })

  it('rejects a return address on another host or path', async () => {
    expect((await call({ ...RB, redirect_uri: 'https://evil.test/whatsapp' }, 'app.test')).status).toBe(400)
    expect((await call({ ...RB, redirect_uri: 'https://app.test/other' }, 'app.test')).status).toBe(400)
    expect(h.exchange).not.toHaveBeenCalled()
  })

  it('asks to finish on a computer when more than one number was shared', async () => {
    h.numbers = [{ id: '111' }, { id: '112' }]
    const res = await call(RB, 'app.test')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/computer/)
    expect(h.saved).toHaveLength(0)
  })

  it('explains when no WhatsApp account was shared', async () => {
    h.shared = []
    const res = await call(RB, 'app.test')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/did not share/)
  })
})
