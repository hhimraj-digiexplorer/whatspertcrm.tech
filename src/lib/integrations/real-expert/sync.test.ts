import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPTIONS } from './config'
import { RealExpertError } from './client'
import { processJob, retryDelayMs, type SyncDeps, type SyncJob } from './sync'

const contact = {
  id: 'c1',
  phone: '919876543210',
  name: 'Asha Verma',
  email: null,
  company: null,
  created_at: '2026-10-01T10:00:00Z',
}

function makeDeps(overrides: Partial<SyncDeps> = {}) {
  const links = new Map<string, string>()
  const send = vi.fn<(path: string, body: unknown, key: string) => Promise<unknown>>(async (path) => (path === DEFAULT_OPTIONS.leads_path ? { data: { id: 'L-9' } } : { ok: true }))
  const deps: SyncDeps = {
    options: DEFAULT_OPTIONS,
    loadContact: async (id) => (id === 'c1' ? contact : null),
    loadDeal: async (id) =>
      id === 'd1'
        ? {
            id: 'd1',
            contact_id: 'c1',
            title: '2BHK Gomti Nagar',
            value: '4500000.00',
            currency: 'INR',
            status: 'active',
            expected_close_date: null,
            updated_at: '2026-10-02T00:00:00Z',
            stage: { id: 's2', name: 'Site visit', position: 2 },
            pipeline: { id: 'p1', name: 'Sales' },
          }
        : null,
    loadMessage: async (id) =>
      id === 'm1'
        ? {
            id: 'm1',
            contact_id: 'c1',
            sender_type: 'customer',
            content_type: 'text',
            content_text: 'Is it available?',
            media_url: null,
            template_name: null,
            status: 'delivered',
            message_id: 'wamid.1',
            created_at: '2026-10-02T00:00:00Z',
          }
        : null,
    getLink: async (cid) => links.get(cid) ?? null,
    saveLink: async (cid, ext) => {
      links.set(cid, ext)
    },
    send,
    ...overrides,
  }
  return { deps, send, links }
}

const job = (kind: SyncJob['kind'], entity_id: string): SyncJob => ({
  id: 1,
  integration_id: 'i1',
  account_id: 'a1',
  kind,
  entity_id,
  attempts: 1,
})

describe('processJob', () => {
  it('creates a lead and remembers its id', async () => {
    const { deps, send, links } = makeDeps()
    expect(await processJob(job('lead', 'c1'), deps)).toBe('done')
    expect(send).toHaveBeenCalledWith(
      '/api/v1/leads',
      expect.objectContaining({ name: 'Asha Verma', phone: '+919876543210', source: 'WhatsApp', whatspert_contact_id: 'c1' }),
      'lead-c1',
    )
    expect(links.get('c1')).toBe('L-9')
  })

  it('skips a contact that is already linked (e.g. came from Real Expert)', async () => {
    const { deps, send, links } = makeDeps()
    links.set('c1', 'RE-1')
    expect(await processJob(job('lead', 'c1'), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('pushes a deal stage onto the linked lead, creating the lead first if needed', async () => {
    const { deps, send } = makeDeps()
    expect(await processJob(job('deal', 'd1'), deps)).toBe('done')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toBe('/api/v1/leads/L-9/stage')
    expect(send.mock.calls[1][1]).toMatchObject({
      lead_id: 'L-9',
      value: 4500000,
      stage: { name: 'Site visit' },
      pipeline: { name: 'Sales' },
    })
  })

  it('logs a message on the lead timeline', async () => {
    const { deps, send, links } = makeDeps()
    links.set('c1', 'RE-1')
    await processJob(job('message', 'm1'), deps)
    expect(send).toHaveBeenCalledWith(
      '/api/v1/leads/RE-1/activities',
      expect.objectContaining({ direction: 'inbound', text: 'Is it available?', whatsapp_message_id: 'wamid.1' }),
      'message-m1',
    )
  })

  it('skips rows that were deleted meanwhile', async () => {
    const { deps, send } = makeDeps()
    expect(await processJob(job('deal', 'gone'), deps)).toBe('skipped')
    expect(await processJob(job('message', 'gone'), deps)).toBe('skipped')
    expect(await processJob(job('lead', 'gone'), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('fails without retry when Real Expert returns no lead id', async () => {
    const { deps } = makeDeps({ send: vi.fn(async () => ({ success: true })) })
    await expect(processJob(job('lead', 'c1'), deps)).rejects.toMatchObject({ retryable: false })
  })

  it('surfaces transport errors', async () => {
    const { deps } = makeDeps({
      send: vi.fn(async () => {
        throw new RealExpertError('down', 503, true)
      }),
    })
    await expect(processJob(job('lead', 'c1'), deps)).rejects.toBeInstanceOf(RealExpertError)
  })
})

describe('retryDelayMs', () => {
  it('backs off and caps', () => {
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(5 * 60_000)
    expect(retryDelayMs(99)).toBe(180 * 60_000)
  })
})
