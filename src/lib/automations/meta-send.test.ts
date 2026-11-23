import { beforeEach, describe, expect, it, vi } from 'vitest'

// Issue: automation template sends dropped the IMAGE/VIDEO header that
// manual sends include, so Meta rejected them with #132012.

const h = vi.hoisted(() => ({
  templates: [] as Record<string, unknown>[],
  sendTemplate: vi.fn<(args: Record<string, unknown>) => Promise<{ messageId: string }>>(async () => ({ messageId: "wamid.T" })),
  inserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/billing/server', () => ({ assertAccountActive: async () => undefined }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: h.sendTemplate,
  sendTextMessage: vi.fn(),
}))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}))

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update', 'order', 'limit']) c[m] = () => c
  c.maybeSingle = async () => result()
  c.single = async () => result()
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej)
  return c
}

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      if (table === 'contacts') return chain(() => ({ data: { id: 'c1', phone: '919876543210', wa_user_id: null }, error: null }))
      if (table === 'whatsapp_config') return chain(() => ({ data: { phone_number_id: 'P1', access_token: 'enc' }, error: null }))
      if (table === 'message_templates') return chain(() => ({ data: h.templates, error: null }))
      if (table === 'messages') {
        return {
          insert: async (row: Record<string, unknown>) => {
            h.inserts.push(row)
            return { error: null }
          },
        }
      }
      return chain(() => ({ data: null, error: null }))
    },
  }),
}))

import { engineSendTemplate } from './meta-send'

const videoTemplate = {
  id: 't1',
  account_id: 'acc1',
  user_id: 'u1',
  name: 'galleria_welcome_video',
  language: 'en',
  category: 'MARKETING',
  status: 'APPROVED',
  header_type: 'video',
  header_content: null,
  header_media_url: 'https://cdn.example.com/welcome.mp4',
  body_text: 'Hi {{1}}, welcome to AIS The Galleria',
  footer_text: null,
  buttons: [],
  created_at: '',
  updated_at: '',
}

beforeEach(() => {
  h.templates = [videoTemplate]
  h.sendTemplate.mockClear()
  h.inserts = []
})

describe('engineSendTemplate', () => {
  it('sends the stored header media with the template, like a manual send', async () => {
    await engineSendTemplate({
      accountId: 'acc1',
      userId: 'u1',
      conversationId: 'conv1',
      contactId: 'c1',
      templateName: 'galleria_welcome_video',
      params: ['Asha'],
    })
    const args = h.sendTemplate.mock.calls[0][0] as Record<string, unknown>
    expect(args.template).toMatchObject({ header_type: 'video', header_media_url: 'https://cdn.example.com/welcome.mp4' })
    // The row's language is used when the step names none ("en", not "en_US").
    expect(args.language).toBe('en')
    expect(h.inserts[0]).toMatchObject({ content_type: 'template', content_text: 'Hi Asha, welcome to AIS The Galleria' })
  })

  it('still sends a template that has no local row (body-only)', async () => {
    h.templates = []
    await engineSendTemplate({
      accountId: 'acc1',
      userId: 'u1',
      conversationId: 'conv1',
      contactId: 'c1',
      templateName: 'remote_only',
      language: 'en',
    })
    const args = h.sendTemplate.mock.calls[0][0] as Record<string, unknown>
    expect(args.template).toBeUndefined()
    expect(args.language).toBe('en')
  })
})
