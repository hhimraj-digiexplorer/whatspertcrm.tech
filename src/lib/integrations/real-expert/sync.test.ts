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

const STAGES = { lead: 'Lead', showing: 'Showing', closed_won: 'Closed Won', closed_lost: 'Closed Lost' }

function deal(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: 'd1',
    contact_id: 'c1',
    title: '2BHK Gomti Nagar',
    value: '4500000.00',
    currency: 'INR',
    status: 'open',
    expected_close_date: '2026-11-30',
    updated_at: '2026-10-02T00:00:00Z',
    stage: { id: 's2', name: 'Showing', position: 2 },
    pipeline: { id: 'p1', name: 'Sales' },
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SyncDeps> = {}, dealRow: DealRow | null = deal()) {
  const links = new Map<string, string>()
  const dealLinks = new Map<string, string>()
  const send = vi.fn<SyncDeps['send']>(async (method, path) => {
    if (path === '/api/v1/leads') return { success: true, lead_id: 42, source: 'whatsapp' }
    if (method === 'POST' && path === '/api/v1/deals') return { success: true, deal_id: 7 }
    return { success: true }
  })
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
    getDealLink: async (id) => dealLinks.get(id) ?? null,
    saveDealLink: async (id, ext) => {
      dealLinks.set(id, ext)
    },
    getStages: async () => STAGES,
    send,
    ...overrides,
  }
  return { deps, send, links, dealLinks }
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
  it('creates a lead in Real Expert format and remembers its id', async () => {
    const { deps, send, links } = makeDeps()
    expect(await processJob(job('lead', 'c1'), deps)).toBe('done')
    expect(send).toHaveBeenCalledWith(
      'POST',
      '/api/v1/leads',
      expect.objectContaining({
        first_name: 'Asha',
        last_name: 'Verma',
        phone: '+919876543210',
        email: 'asha@example.com',
        source: 'WhatsApp',
        external_id: 'c1',
      }),
      'lead-c1',
    )
    expect(links.get('c1')).toBe('42')
  })

  it('skips a contact that is already linked (e.g. came from Real Expert)', async () => {
    const { deps, send, links } = makeDeps()
    links.set('c1', '9')
    expect(await processJob(job('lead', 'c1'), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('creates the Real Expert deal on first sync with the matching stage', async () => {
    const { deps, send, dealLinks } = makeDeps()
    expect(await processJob(job('deal', 'd1'), deps)).toBe('done')
    expect(send).toHaveBeenCalledTimes(2) // lead, then deal
    expect(send.mock.calls[1]).toEqual([
      'POST',
      '/api/v1/deals',
      { title: '2BHK Gomti Nagar', contract_price: 4500000, closing_date: '2026-11-30', stage: 'showing', lead_id: 42 },
      'deal-d1-2026-10-02T00:00:00Z',
    ])
    expect(dealLinks.get('d1')).toBe('7')
  })

  it('updates the existing deal with PUT; won deals become closed_won', async () => {
    const { deps, send, links, dealLinks } = makeDeps({}, deal({ status: 'won' }))
    links.set('c1', '42')
    dealLinks.set('d1', '7')
    await processJob(job('deal', 'd1'), deps)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe('PUT')
    expect(send.mock.calls[0][1]).toBe('/api/v1/deals/7')
    expect(send.mock.calls[0][2]).toMatchObject({ stage: 'closed_won' })
  })

  it('logs a note when the Whatspert stage has no Real Expert match', async () => {
    const { deps, send, links, dealLinks } = makeDeps({}, deal({ stage: { id: 's9', name: 'Follow up', position: 9 } }))
    links.set('c1', '42')
    dealLinks.set('d1', '7')
    await processJob(job('deal', 'd1'), deps)
    expect(send.mock.calls[0][2]).not.toHaveProperty('stage')
    expect(send.mock.calls[1][0]).toBe('POST')
    expect(send.mock.calls[1][1]).toBe('/api/v1/activities')
    expect(send.mock.calls[1][2]).toMatchObject({ lead_id: 42, type: 'note' })
    expect(String((send.mock.calls[1][2] as { body: string }).body)).toContain('Stage: Follow up')
  })

  it('uses the stage map for differently named stages', async () => {
    const { deps, send, links, dealLinks } = makeDeps(
      { options: { ...DEFAULT_OPTIONS, stage_map: { 'site visit': 'showing' } } },
      deal({ stage: { id: 's3', name: 'Site Visit', position: 3 } }),
    )
    links.set('c1', '42')
    dealLinks.set('d1', '7')
    await processJob(job('deal', 'd1'), deps)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][2]).toMatchObject({ stage: 'showing' })
  })

  it('logs a message as a Real Expert activity', async () => {
    const { deps, send, links } = makeDeps()
    links.set('c1', '42')
    await processJob(job('message', 'm1'), deps)
    expect(send).toHaveBeenCalledWith(
      'POST',
      '/api/v1/activities',
      {
        lead_id: 42,
        type: 'sms',
        subject: 'WhatsApp message received',
        body: 'Is it available?',
        logged_at: '2026-10-02T00:00:00Z',
      },
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
