import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPTIONS } from './config'
import { RealExpertError } from './client'
import { processJob, retryDelayMs, type DealRow, type SyncDeps, type SyncJob } from './sync'

const contact = {
  id: 'c1',
  phone: '919876543210',
  name: 'Asha Verma',
  email: 'asha@example.com',
  company: null,
  created_at: '2026-10-01T10:00:00Z',
}

function deal(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: 'd1',
    contact_id: 'c1',
    title: '2BHK Gomti Nagar',
    value: '4500000.00',
    currency: 'INR',
    status: 'open',
    expected_close_date: null,
    updated_at: '2026-10-02T00:00:00Z',
    stage: { id: 's2', name: 'Site visit', position: 2 },
    pipeline: { id: 'p1', name: 'Sales' },
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SyncDeps> = {}, dealRow: DealRow | null = deal()) {
  const links = new Map<string, string>()
  const send = vi.fn<SyncDeps['send']>(async (path) =>
    path === '/api/v1/leads' ? { id: 'L-9', lead_id: 'L-9', status: 'created', duplicate: false } : { ok: true },
  )
  const deps: SyncDeps = {
    options: DEFAULT_OPTIONS,
    loadContact: async (id) => (id === 'c1' ? contact : null),
    loadDeal: async (id) => (id === 'd1' ? dealRow : null),
    loadMessage: async (id) =>
      id === 'm1'
        ? {
            id: 'm1',
            contact_id: 'c1',
            sender_type: 'customer',
            content_type: 'text',
            content_text: 'Is the flat still available?',
            media_url: null,
            template_name: null,
            status: 'delivered',
            message_id: 'wamid.1',
            created_at: '2026-10-02T09:31:00Z',
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

describe('processJob — Real Expert Public API v1', () => {
  it('POST /v1/leads with the documented body, and remembers the id', async () => {
    const { deps, send, links } = makeDeps()
    expect(await processJob(job('lead', 'c1'), deps)).toBe('done')
    expect(send).toHaveBeenCalledWith(
      '/api/v1/leads',
      {
        name: 'Asha Verma',
        phone: '+919876543210',
        email: 'asha@example.com',
        company: null,
        source: 'WhatsApp',
        whatspert_contact_id: 'c1',
        created_at: '2026-10-01T10:00:00Z',
      },
      'lead-c1',
    )
    expect(links.get('c1')).toBe('L-9')
  })

  it('sends no name when the contact only has a number', async () => {
    const { deps, send } = makeDeps({ loadContact: async () => ({ ...contact, name: '919876543210' }) })
    await processJob(job('lead', 'c1'), deps)
    expect(send.mock.calls[0][1]).toMatchObject({ name: null })
  })

  it('skips a contact that is already linked (e.g. came from Real Expert)', async () => {
    const { deps, send, links } = makeDeps()
    links.set('c1', 'RE-1')
    expect(await processJob(job('lead', 'c1'), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('POST /v1/leads/{lead_id}/stage with the stage name, creating the lead first if needed', async () => {
    const { deps, send } = makeDeps()
    expect(await processJob(job('deal', 'd1'), deps)).toBe('done')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toBe('/api/v1/leads/L-9/stage')
    expect(send.mock.calls[1][1]).toMatchObject({
      title: '2BHK Gomti Nagar',
      value: 4500000,
      currency: 'INR',
      status: 'open',
      stage: { name: 'Site visit' },
      pipeline: { name: 'Sales' },
    })
  })

  it('POST /v1/leads/{lead_id}/activities with the documented message body', async () => {
    const { deps, send, links } = makeDeps()
    links.set('c1', 'RE-1')
    await processJob(job('message', 'm1'), deps)
    expect(send).toHaveBeenCalledWith(
      '/api/v1/leads/RE-1/activities',
      expect.objectContaining({
        type: 'whatsapp_message',
        direction: 'inbound',
        sender: 'customer',
        message_type: 'text',
        text: 'Is the flat still available?',
        media_url: null,
        template_name: null,
        status: 'delivered',
        whatsapp_message_id: 'wamid.1',
        sent_at: '2026-10-02T09:31:00Z',
      }),
      'message-m1',
    )
  })

  it('skips rows that were deleted meanwhile', async () => {
    const { deps, send } = makeDeps({}, null)
    expect(await processJob(job('deal', 'd1'), deps)).toBe('skipped')
    expect(await processJob(job('message', 'gone'), deps)).toBe('skipped')
    expect(await processJob(job('lead', 'gone'), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('fails without retry when Real Expert returns no lead id', async () => {
    const { deps } = makeDeps({ send: vi.fn(async () => ({ ok: true })) })
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
