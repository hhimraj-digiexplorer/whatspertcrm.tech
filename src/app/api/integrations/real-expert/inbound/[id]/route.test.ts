import { beforeEach, describe, expect, it, vi } from 'vitest'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

const h = vi.hoisted(() => ({
  integration: null as Record<string, unknown> | null,
  links: [] as Record<string, unknown>[],
  deletedJobs: 0,
  templateBody: 'Hi {{1}}, thanks for your interest!' as string | null,
  ownLink: null as Record<string, unknown> | null,
  entitled: true,
  resolve: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc\(|\)$/g, '') }))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ resolveConversationByPhone: h.resolve }))
vi.mock('@/lib/whatsapp/send-message', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/send-message')>()),
  sendMessageToConversation: h.send,
}))

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'limit', 'update', 'delete']) c[m] = () => c
  c.maybeSingle = async () => result()
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
  return c
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async () => ({ data: h.entitled, error: null }),
    from(table: string) {
      if (table === 'crm_integrations') return chain(() => ({ data: h.integration, error: null }))
      if (table === 'message_templates') return chain(() => ({ data: { body_text: h.templateBody }, error: null }))
      if (table === 'crm_contact_links') {
        return {
          ...chain(() => ({ data: h.ownLink, error: null })),
          upsert: async (row: Record<string, unknown>) => {
            h.links.push(row)
            return { error: null }
          },
        }
      }
      if (table === 'crm_sync_queue') {
        h.deletedJobs++
        return chain(() => ({ data: null, error: null }))
      }
      return chain(() => ({ data: null, error: null }))
    },
  }),
}))

import { createHmac } from 'node:crypto'
import { POST } from './route'
import { SendMessageError } from '@/lib/whatsapp/send-message'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const call = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer rex_secret' }, id = ID) =>
  POST(new Request('http://x', { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  __resetRateLimitForTests()
  h.integration = {
    id: ID,
    account_id: 'acc1',
    is_active: true,
    inbound_enabled: true,
    inbound_token: 'enc(rex_secret)',
    welcome_template_name: 'welcome_lead',
    welcome_template_language: 'en',
    options: {},
  }
  h.links = []
  h.deletedJobs = 0
  h.ownLink = null
  h.entitled = true
  h.templateBody = 'Hi {{1}}, thanks for your interest!'
  h.resolve.mockReset().mockResolvedValue({ conversationId: 'conv1', contactId: 'c1', contactCreated: true })
  h.send.mockReset().mockResolvedValue({ messageId: 'm1', whatsappMessageId: 'wamid.1' })
})

describe('POST /api/integrations/real-expert/inbound/[id]', () => {
  it('adds the lead, links it and sends the welcome template', async () => {
    const res = await call({ lead_id: 'RE-77', name: 'Asha Verma', phone: '98765 43210' })
    expect(res.status).toBe(200)
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), 'acc1', '+919876543210', 'Asha Verma')
    expect(h.links[0]).toMatchObject({ contact_id: 'c1', external_id: 'RE-77', origin: 'real_expert' })
    expect(h.deletedJobs).toBeGreaterThan(0)
    expect(h.send).toHaveBeenCalledWith(expect.anything(), 'acc1', {
      conversationId: 'conv1',
      messageType: 'template',
      templateName: 'welcome_lead',
      templateLanguage: 'en',
      templateParams: ['Asha'],
    })
    expect(await res.json()).toMatchObject({ message_sent: true, whatsapp_message_id: 'wamid.1' })
  })

  it('accepts the X-Whatspert-Token header and a nested lead with its own template', async () => {
    const res = await call(
      { lead: { id: 5, phone: '+971501234567', template: { name: 'promo', language: 'ar', variables: ['x', 'y'] } } },
      { 'x-whatspert-token': 'rex_secret' },
    )
    expect(res.status).toBe(200)
    expect(h.send.mock.calls[0][2]).toMatchObject({ templateName: 'promo', templateLanguage: 'ar', templateParams: ['x', 'y'] })
  })

  it('rejects a wrong or missing token', async () => {
    expect((await call({ phone: '9876543210' }, { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await call({ phone: '9876543210' }, {})).status).toBe(401)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('404s for unknown or malformed ids', async () => {
    expect((await call({}, undefined, 'abc')).status).toBe(404)
    h.integration = null
    expect((await call({ phone: '9876543210' })).status).toBe(404)
  })

  it('refuses when receiving leads is off', async () => {
    h.integration!.inbound_enabled = false
    expect((await call({ phone: '9876543210' })).status).toBe(403)
  })

  it('400s without a usable phone number', async () => {
    expect((await call({ name: 'No phone' })).status).toBe(400)
  })

  it('passes WhatsApp errors through', async () => {
    h.send.mockRejectedValue(new SendMessageError('template_not_found', 'Template not approved', 400))
    const res = await call({ phone: '9876543210' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'template_not_found' })
  })

  it('sends no variables to a template without placeholders', async () => {
    h.templateBody = 'Welcome to our project!'
    await call({ phone: '9876543210', name: 'Ravi' })
    expect(h.send.mock.calls[0][2].templateParams).toEqual([])
  })

  it('accepts a signed Real Expert lead.created webhook', async () => {
    const body = JSON.stringify({
      event: 'lead.created',
      timestamp: '2026-10-03T10:00:00+05:30',
      data: { lead_id: 77, first_name: 'Ravi', last_name: 'Kumar', email: null, phone: '9876543210', source: 'website', status: 'new' },
    })
    const sig = createHmac('sha256', 'rex_secret').update(body).digest('hex')
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-webhook-signature': sig }, body }),
      { params: Promise.resolve({ id: ID }) },
    )
    expect(res.status).toBe(200)
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), 'acc1', '+919876543210', 'Ravi Kumar')
    expect(h.links[0]).toMatchObject({ external_id: '77', origin: 'real_expert' })
    expect(h.send.mock.calls[0][2].templateParams).toEqual(['Ravi'])
  })

  it('rejects a bad signature', async () => {
    const body = JSON.stringify({ event: 'lead.created', data: { phone: '9876543210' } })
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-webhook-signature': 'deadbeef' }, body }),
      { params: Promise.resolve({ id: ID }) },
    )
    expect(res.status).toBe(401)
  })

  it('ignores other Real Expert events', async () => {
    const res = await call({ event: 'deal.stage_changed', data: { lead_id: 1 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ignored: true })
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('does not greet leads Whatspert itself created', async () => {
    const bySource = await call({ event: 'lead.created', data: { lead_id: 5, first_name: 'A', phone: '9876543210', source: 'whatsapp' } })
    expect(await bySource.json()).toMatchObject({ ignored: true, reason: 'own_lead' })
    h.ownLink = { contact_id: 'c1' }
    const byLink = await call({ event: 'lead.created', data: { lead_id: 5, first_name: 'A', phone: '9876543210', source: 'website' } })
    expect(await byLink.json()).toMatchObject({ ignored: true, reason: 'own_lead' })
    expect(h.send).not.toHaveBeenCalled()
  })

  it('refuses leads while the add-on is locked (not paid for both)', async () => {
    h.entitled = false
    const res = await call({ phone: '9876543210' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'locked' })
    expect(h.resolve).not.toHaveBeenCalled()
  })
})
