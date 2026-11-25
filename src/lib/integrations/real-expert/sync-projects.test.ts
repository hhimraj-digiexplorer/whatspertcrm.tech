import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPTIONS, type RealExpertOptions } from './config'
import { buildLeadPayload, buildStagePayload, dealProjectTag, processJob, type ContactRow, type DealRow, type SyncDeps, type SyncJob } from './sync'

const options: RealExpertOptions = {
  ...DEFAULT_OPTIONS,
  projects: {
    galleria: { name: 'AIS Galleria', tag: 'p-galleria', code: 'GAL-01' },
    'sky-heights': { name: 'Sky Heights', tag: 'p-sky', code: 'SKY' },
  },
}

const contact: ContactRow = {
  id: 'c1',
  phone: '919876543210',
  name: 'Asha',
  email: null,
  company: null,
  created_at: '2026-11-01T10:00:00Z',
  project_tags: ['p-galleria'],
}

function deal(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: 'd1',
    contact_id: 'c1',
    title: 'Flat',
    value: 100,
    currency: 'INR',
    status: 'open',
    expected_close_date: null,
    updated_at: '2026-11-02T00:00:00Z',
    stage: { id: 's', name: 'Site visit', position: 1 },
    pipeline: { id: 'p', name: 'Sales' },
    project_tags: ['p-galleria'],
    ...overrides,
  }
}

function makeDeps(c: ContactRow | null = contact) {
  const links = new Map<string, string>()
  const send = vi.fn<SyncDeps['send']>(async (path) => (path === '/api/v1/leads' ? { id: 'L-1' } : { ok: true }))
  const deps: SyncDeps = {
    options,
    loadContact: async (id) => (c && id === c.id ? c : null),
    loadDeal: async () => null,
    loadMessage: async () => null,
    getLink: async (id) => links.get(id) ?? null,
    saveLink: async (id, ext) => {
      links.set(id, ext)
    },
    send,
  }
  return { deps, send, links }
}

const enquiry = (payload: Record<string, unknown>): SyncJob => ({
  id: 1,
  integration_id: 'i1',
  account_id: 'a1',
  kind: 'enquiry',
  entity_id: 'ct-1',
  attempts: 1,
  payload,
})

describe('project fields sent to Real Expert', () => {
  it('a WhatsApp-first lead carries its first project, code and every project tag', () => {
    const body = buildLeadPayload({ ...contact, project_tags: ['p-galleria', 'p-sky'] }, options)
    expect(body).toMatchObject({
      project: 'AIS Galleria',
      project_code: 'GAL-01',
      project_tag: 'p-galleria',
      project_tags: ['p-galleria', 'p-sky'],
    })
  })

  it('a lead with no project tag has no project fields', () => {
    const body = buildLeadPayload({ ...contact, project_tags: [] }, options)
    expect(body).not.toHaveProperty('project')
    expect(body).not.toHaveProperty('project_tags')
  })

  it('an unconfigured project tag is sent as the project name', () => {
    expect(buildLeadPayload({ ...contact, project_tags: ['p-new'] }, options)).toMatchObject({
      project: 'p-new',
      project_code: null,
      project_tag: 'p-new',
    })
  })

  it('stage sync includes the pipeline name and project_code', () => {
    expect(buildStagePayload(deal(), options)).toMatchObject({
      pipeline: { name: 'Sales' },
      project: 'AIS Galleria',
      project_code: 'GAL-01',
    })
  })

  it('a deal in a project-named pipeline is that project, even with two project tags', () => {
    const d = deal({ pipeline: { id: 'p', name: 'Sky Heights' }, project_tags: ['p-galleria', 'p-sky'] })
    expect(dealProjectTag(d, options)).toBe('p-sky')
    expect(buildStagePayload(d, options)).toMatchObject({ project_code: 'SKY' })
  })
})

describe('processJob — enquiry', () => {
  it('creates the lead for that project when the contact is not in Real Expert yet', async () => {
    const { deps, send, links } = makeDeps({ ...contact, project_tags: ['p-galleria', 'p-sky'] })
    expect(await processJob(enquiry({ contact_id: 'c1', tag_id: 't-sky', tag_name: 'p-sky' }), deps)).toBe('done')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe('/api/v1/leads')
    expect(send.mock.calls[0][1]).toMatchObject({ project: 'Sky Heights', project_code: 'SKY' })
    expect(send.mock.calls[0][1]).not.toHaveProperty('is_repeat_enquiry')
    expect(links.get('c1')).toBe('L-1')
  })

  it('sends a repeat enquiry for the new project when the lead already exists', async () => {
    const { deps, send, links } = makeDeps({ ...contact, project_tags: ['p-galleria', 'p-sky'] })
    links.set('c1', 'RE-7')
    await processJob(enquiry({ contact_id: 'c1', tag_id: 't-sky', tag_name: 'p-sky' }), deps)
    expect(send).toHaveBeenCalledWith(
      '/api/v1/leads',
      expect.objectContaining({ project: 'Sky Heights', project_code: 'SKY', is_repeat_enquiry: true, lead_id: 'RE-7' }),
      'enquiry-c1-t-sky',
    )
  })

  it('skips when the project tag was removed before the job ran', async () => {
    const { deps, send } = makeDeps({ ...contact, project_tags: ['p-galleria'] })
    expect(await processJob(enquiry({ contact_id: 'c1', tag_id: 't-sky', tag_name: 'p-sky' }), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })

  it('skips a malformed or orphaned job', async () => {
    const { deps, send } = makeDeps(null)
    expect(await processJob(enquiry({}), deps)).toBe('skipped')
    expect(await processJob(enquiry({ contact_id: 'c1', tag_name: 'p-sky' }), deps)).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })
})
