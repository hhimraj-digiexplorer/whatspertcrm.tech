import { beforeEach, describe, expect, it, vi } from 'vitest'

// Issue: saving the welcome template on a partner-managed integration
// always 500'd. The PUT upserted a row without the NOT NULL api_key /
// inbound_token columns; Postgres checks NOT NULL on the would-be
// insert before resolving the conflict.

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  writes: [] as { op: string; payload: Record<string, unknown>; filters: [string, unknown][] }[],
}))

function userClient() {
  return {
    from() {
      const filters: [string, unknown][] = []
      let op = 'select'
      let payload: Record<string, unknown> = {}
      const c: Record<string, unknown> = {
        select: () => c,
        eq: (k: string, v: unknown) => (filters.push([k, v]), c),
        update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), c),
        upsert: (p: Record<string, unknown>) => ((op = 'upsert'), (payload = p), c),
        maybeSingle: async () => ({ data: h.row, error: null }),
        single: async () => {
          h.writes.push({ op, payload, filters })
          if (op === 'upsert' && (!('api_key' in payload) || !('inbound_token' in payload))) {
            return { data: null, error: { code: '23502', message: 'null value in column "api_key" violates not-null constraint' } }
          }
          return { data: { ...h.row, ...payload }, error: null }
        },
      }
      return c
    },
  }
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ supabase: userClient(), accountId: 'acc1', userId: 'u1', role: 'admin' }),
  toErrorResponse: (err: unknown) => Response.json({ error: 'Internal server error', detail: String((err as { message?: string })?.message ?? err) }, { status: 500 }),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (v: string) => `enc(${v})`, decrypt: (v: string) => v.replace(/^enc\(|\)$/g, '') }))
vi.mock('@/lib/partner/real-expert', () => ({
  loadEntitlement: async () => ({ entitled: true, reason: null }),
}))
vi.mock('@/lib/automations/admin-client', () => {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update']) c[m] = () => c
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ count: 0, data: null, error: null }).then(res, rej)
  return { supabaseAdmin: () => ({ from: () => c }) }
})

import { PUT } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const put = (body: unknown) =>
  PUT(new Request('http://x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  __resetRateLimitForTests()
  h.writes = []
  h.row = {
    id: 'int1',
    partner_ref: 're:crm.digiexplorer.in:abc',
    partner_crm_active: true,
    partner_crm_plan: 'pro',
    is_active: true,
    base_url: 'https://crm.digiexplorer.in',
    api_key: 'enc(re_key)',
    inbound_token: 'enc(rex_tok)',
    sync_new_leads: true,
    sync_deals: true,
    sync_messages: true,
    inbound_enabled: true,
    welcome_template_name: null,
    welcome_template_language: null,
    options: { source_tags: { WEBSITE: 'website' } },
    last_sync_at: null,
    last_error: null,
    last_error_at: null,
  }
})

describe('PUT /api/integrations/real-expert', () => {
  it('saves the welcome template on a partner-managed integration (the body the UI sends)', async () => {
    const res = await put({
      is_active: true,
      base_url: 'https://crm.digiexplorer.in',
      sync_new_leads: true,
      sync_deals: true,
      sync_messages: true,
      inbound_enabled: true,
      welcome_template_name: 'galleria_lead_received_auto',
      welcome_template_language: 'en',
      options: { auth_style: 'bearer', leads_path: '/api/v1/leads', default_country_code: '91', lead_source: 'WhatsApp' },
    })
    expect(res.status).toBe(200)
    const write = h.writes[0]
    expect(write.op).toBe('update')
    expect(write.filters).toContainEqual(['id', 'int1'])
    expect(write.payload).toMatchObject({ welcome_template_name: 'galleria_lead_received_auto', welcome_template_language: 'en' })
    // Options the client didn't send are kept.
    expect((write.payload.options as Record<string, unknown>).source_tags).toEqual({ WEBSITE: 'website' })
    const body = await res.json()
    expect(body.integration.welcome_template_name).toBe('galleria_lead_received_auto')
  })

  it('saves a minimal body', async () => {
    const res = await put({ welcome_template_name: 'x', welcome_template_language: 'en' })
    expect(res.status).toBe(200)
  })

  it('saves the lead tag map and the greeting owner', async () => {
    const res = await put({ options: { source_tags: { META: 'meta-form' }, greeting_by: 'real_expert' } })
    expect(res.status).toBe(200)
    expect(h.writes[0].payload.options).toMatchObject({ source_tags: { META: 'meta-form' }, greeting_by: 'real_expert' })
  })

  it('ignores address and key changes on a partner-managed integration', async () => {
    await put({ base_url: 'https://evil.example.com', api_key: 'new' })
    expect(h.writes[0].payload.base_url).toBe('https://crm.digiexplorer.in')
    expect(h.writes[0].payload).not.toHaveProperty('api_key')
  })

  it('rejects a bad tag map', async () => {
    const res = await put({ options: { source_tags: { META: '' + 'x'.repeat(60) } } })
    expect(res.status).toBe(400)
  })

  it('still refuses to create a connection by hand', async () => {
    h.row = null
    expect((await put({ base_url: 'https://crm.digiexplorer.in' })).status).toBe(403)
  })
})
