import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  conn: {
    phoneNumberId: '111',
    wabaId: '222',
    accessToken: 'tok',
    onboardingMethod: 'embedded',
    twoStepPin: '000000' as string | null,
  },
  apps: [{ whatsapp_business_api_data: { id: 'app1' } }] as { whatsapp_business_api_data?: { id?: string } }[],
  phone: { id: '111', status: 'CONNECTED', platform_type: 'CLOUD_API' } as Record<string, string>,
  updated: [] as Record<string, unknown>[],
  subscribe: vi.fn(),
  register: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/account')>()),
  requireRole: async () => ({
    userId: 'u1',
    accountId: 'acc1',
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
vi.mock('@/lib/whatsapp/connection', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/connection')>()),
  loadAccountConnection: async () => h.conn,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  subscribeWabaToApp: h.subscribe,
  getSubscribedApps: async () => h.apps,
  getPhoneNumberState: async () => h.phone,
  registerPhoneNumber: h.register,
  getWabaSetupStatus: vi.fn(),
}))

import { POST } from './route'

beforeEach(() => {
  process.env.NEXT_PUBLIC_META_APP_ID = 'app1'
  h.conn = { phoneNumberId: '111', wabaId: '222', accessToken: 'tok', onboardingMethod: 'embedded', twoStepPin: '000000' }
  h.apps = [{ whatsapp_business_api_data: { id: 'app1' } }]
  h.phone = { id: '111', status: 'CONNECTED', platform_type: 'CLOUD_API' }
  h.updated = []
  h.subscribe.mockReset().mockResolvedValue(undefined)
  h.register.mockReset().mockResolvedValue({ success: true })
})

describe('POST /api/whatsapp/health (Fix connection)', () => {
  it('re-subscribes and leaves a healthy number alone', async () => {
    const res = await POST()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(h.subscribe).toHaveBeenCalledWith({ wabaId: '222', accessToken: 'tok' })
    expect(h.register).not.toHaveBeenCalled()
    expect(body.steps).toEqual([
      { key: 'subscribe', state: 'ok' },
      { key: 'verify_subscription', state: 'ok' },
      { key: 'register', state: 'skipped' },
    ])
    expect(h.updated[0]).toMatchObject({ status: 'connected' })
  })

  it('registers again with the saved PIN when the number dropped off the Cloud API', async () => {
    h.phone = { id: '111', status: 'PENDING', platform_type: 'ON_PREMISE' }
    const body = await (await POST()).json()
    expect(h.register).toHaveBeenCalledWith({ phoneNumberId: '111', accessToken: 'tok', pin: '000000' })
    expect(body.ok).toBe(true)
  })

  it('asks for the PIN when none is saved', async () => {
    h.phone = { id: '111', status: 'PENDING', platform_type: 'ON_PREMISE' }
    h.conn.twoStepPin = null
    const body = await (await POST()).json()
    expect(body.ok).toBe(false)
    expect(body.steps[2]).toMatchObject({ key: 'register', state: 'needs_pin' })
    expect(h.updated[0].status).toBeUndefined()
  })

  it('reports when our app is still not subscribed', async () => {
    h.apps = [{ whatsapp_business_api_data: { id: 'someone-else' } }]
    const body = await (await POST()).json()
    expect(body.ok).toBe(false)
    expect(body.steps[1]).toMatchObject({ key: 'verify_subscription', state: 'fail' })
  })

  it('never registers a WhatsApp Business app (coexistence) number', async () => {
    h.conn.onboardingMethod = 'coexistence'
    h.phone = { id: '111', status: 'CONNECTED', platform_type: 'NOT_APPLICABLE' }
    const body = await (await POST()).json()
    expect(h.register).not.toHaveBeenCalled()
    expect(body.steps[2]).toEqual({ key: 'register', state: 'skipped' })
  })
})
