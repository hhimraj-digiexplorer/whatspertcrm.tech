import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  numbers: [{ id: '111' }, { id: '333' }] as { id: string }[],
  claimed: null as Record<string, unknown> | null,
  updated: [] as Record<string, unknown>[],
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  register: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/account')>()),
  requireRole: async () => ({
    userId: 'u1',
    accountId: 'acc1',
    role: 'admin',
    supabase: {
      from: () => ({
        update: (row: Record<string, unknown>) => ({
          eq: async () => {
            h.updated.push(row)
            return { error: null }
          },
        }),
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
vi.mock('@/lib/whatsapp/connection', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/connection')>()),
  loadAccountConnection: async () => ({
    phoneNumberId: '111',
    wabaId: '222',
    accessToken: 'tok',
    onboardingMethod: 'embedded',
    twoStepPin: '000000',
  }),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (v: string) => `enc(${v})` }))
vi.mock('@/lib/whatsapp/embedded-signup', () => ({ generateTwoStepPin: () => '654321' }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  listWabaPhoneNumbers: async () => h.numbers,
  requestVerificationCode: h.requestCode,
  verifyPhoneCode: h.verifyCode,
  registerPhoneNumber: h.register,
  subscribeWabaToApp: h.subscribe,
}))

import { POST } from './route'

const call = (id: string, body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  h.numbers = [{ id: '111' }, { id: '333' }]
  h.claimed = null
  h.updated = []
  h.requestCode.mockReset().mockResolvedValue(undefined)
  h.verifyCode.mockReset().mockResolvedValue(undefined)
  h.register.mockReset().mockResolvedValue({ success: true })
  h.subscribe.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/whatsapp/numbers/[id]', () => {
  it('refuses a number outside the account’s WhatsApp Business Account', async () => {
    const res = await call('999', { action: 'request_code' })
    expect(res.status).toBe(404)
    expect(h.requestCode).not.toHaveBeenCalled()
  })

  it('sends the code by SMS by default, or by voice', async () => {
    expect((await call('333', { action: 'request_code' })).status).toBe(200)
    expect(h.requestCode).toHaveBeenLastCalledWith({ phoneNumberId: '333', accessToken: 'tok', method: 'SMS', language: 'en' })
    await call('333', { action: 'request_code', method: 'VOICE' })
    expect(h.requestCode).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'VOICE' }))
  })

  it('checks the code format before calling Meta', async () => {
    expect((await call('333', { action: 'verify', code: '12' })).status).toBe(400)
    expect(h.verifyCode).not.toHaveBeenCalled()
    expect((await call('333', { action: 'verify', code: '123 456' })).status).toBe(200)
    expect(h.verifyCode).toHaveBeenCalledWith({ phoneNumberId: '333', accessToken: 'tok', code: '123456' })
  })

  it('activates: registers with a new PIN, subscribes, and switches the workspace number', async () => {
    const res = await call('333', { action: 'activate' })
    expect(res.status).toBe(200)
    expect(h.register).toHaveBeenCalledWith({ phoneNumberId: '333', accessToken: 'tok', pin: '654321' })
    expect(h.subscribe).toHaveBeenCalledWith({ wabaId: '222', accessToken: 'tok' })
    expect(h.updated[0]).toMatchObject({ phone_number_id: '333', two_step_pin: 'enc(654321)', status: 'connected' })
  })

  it('uses the PIN the admin typed for a number that already has one', async () => {
    await call('333', { action: 'activate', pin: '112233' })
    expect(h.register).toHaveBeenCalledWith(expect.objectContaining({ pin: '112233' }))
    expect((await call('333', { action: 'activate', pin: '12' })).status).toBe(400)
  })

  it('will not take a number another workspace uses', async () => {
    h.claimed = { account_id: 'other' }
    const res = await call('333', { action: 'activate' })
    expect(res.status).toBe(409)
    expect(h.register).not.toHaveBeenCalled()
  })

  it('does not save when Meta refuses the registration', async () => {
    h.register.mockRejectedValue(Object.assign(new Error('PIN mismatch'), { code: 133005, httpStatus: 400 }))
    const res = await call('333', { action: 'activate' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.updated).toHaveLength(0)
  })
})
