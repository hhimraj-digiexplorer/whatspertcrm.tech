import { describe, expect, it } from 'vitest'
import {
  chooseWelcome,
  leadNamesProject,
  matchProject,
  DEFAULT_OPTIONS,
  extractExternalId,
  isSafePath,
  leadTagNames,
  normalizeBaseUrl,
  fillPath,
  parseOptions,
  toInternationalDigits,
} from './config'

describe('normalizeBaseUrl', () => {
  it('keeps https URLs and drops the trailing slash', () => {
    expect(normalizeBaseUrl('https://crm.digiexplorer.in/')).toBe('https://crm.digiexplorer.in')
    expect(normalizeBaseUrl(' https://x.in/realexpert// ')).toBe('https://x.in/realexpert')
  })
  it('rejects http, credentials, queries and junk', () => {
    expect(normalizeBaseUrl('http://crm.example.com')).toBeNull()
    expect(normalizeBaseUrl('https://u:p@crm.example.com')).toBeNull()
    expect(normalizeBaseUrl('https://crm.example.com/?a=1')).toBeNull()
    expect(normalizeBaseUrl('not a url')).toBeNull()
  })
  it('allows http://localhost only when asked', () => {
    expect(normalizeBaseUrl('http://localhost:4000')).toBeNull()
    expect(normalizeBaseUrl('http://localhost:4000', true)).toBe('http://localhost:4000')
    expect(normalizeBaseUrl('http://example.com', true)).toBeNull()
  })
})

describe('parseOptions', () => {
  it('accepts who greets new leads and rejects anything else', () => {
    expect(parseOptions({ greeting_by: 'real_expert' }).options.greeting_by).toBe('real_expert')
    expect(parseOptions({}).options.greeting_by).toBe('whatspert')
    expect(parseOptions({ greeting_by: 'both' }).invalid).toEqual(['greeting_by'])
  })
  it('defaults to Real Expert Public API v1', () => {
    const { options, invalid } = parseOptions(undefined)
    expect(invalid).toEqual([])
    expect(options).toEqual({
      auth_style: 'bearer',
      leads_path: '/api/v1/leads',
      stage_path: '/api/v1/leads/{lead_id}/stage',
      activities_path: '/api/v1/leads/{lead_id}/activities',
      test_path: '/api/v1/me',
      default_country_code: '91',
      lead_source: 'WhatsApp',
      source_tags: {},
      greeting_by: 'whatspert',
      projects: {},
      fallback_welcome: true,
    })
  })
  it('normalises source → tag mappings and rejects bad tag names', () => {
    const ok = parseOptions({ source_tags: { meta: 'meta-form', 'Google Ads': ' google ads ', WEBSITE: '' } })
    expect(ok.invalid).toEqual([])
    expect(ok.options.source_tags).toEqual({ META: 'meta-form', GOOGLE_ADS: 'google ads' })
    expect(parseOptions({ source_tags: { META: 'x'.repeat(51) } }).invalid).toEqual(['source_tags'])
    expect(parseOptions({ source_tags: ['META'] }).invalid).toEqual(['source_tags'])
  })
  it('builds a lead tag list from its source and payload tags', () => {
    const map = { META: 'meta-form' }
    expect(leadTagNames(map, 'meta', ['Hot', 'meta-form', ' hot '])).toEqual(['meta-form', 'Hot'])
    expect(leadTagNames(map, 'WEBSITE', 'a, b')).toEqual(['a', 'b'])
    expect(leadTagNames(map, null, undefined)).toEqual([])
  })
  it('accepts valid overrides and reports bad ones', () => {
    const { options, invalid } = parseOptions({
      auth_style: 'x-api-key',
      leads_path: '/leads/',
      stage_path: 'https://evil.com/x',
      activities_path: '/a/../b',
      test_path: '/x/{other}',
      default_country_code: '+971',
      deals_path: '/ignored', // old setting, ignored
    })
    expect(options.auth_style).toBe('x-api-key')
    expect(options.leads_path).toBe('/leads')
    expect(options.stage_path).toBe(DEFAULT_OPTIONS.stage_path)
    expect(options.default_country_code).toBe('971')
    expect(invalid).toEqual(['stage_path', 'activities_path', 'test_path'])
  })
})

describe('isSafePath / fillPath', () => {
  it('only allows plain relative paths with {lead_id}', () => {
    expect(isSafePath('/api/v1/leads/{lead_id}/stage')).toBe(true)
    expect(isSafePath('//evil.com')).toBe(false)
    expect(isSafePath('/x?y=1')).toBe(false)
    expect(isSafePath('api/v1')).toBe(false)
  })
  it('url-encodes the lead id', () => {
    expect(fillPath('/api/v1/leads/{lead_id}/stage', 'a/b c')).toBe('/api/v1/leads/a%2Fb%20c/stage')
  })
})

describe('toInternationalDigits', () => {
  it('adds the default country code to national numbers', () => {
    expect(toInternationalDigits('98765 43210', '91')).toBe('919876543210')
    expect(toInternationalDigits('098765-43210', '91')).toBe('919876543210')
  })
  it('keeps numbers that already have a country code', () => {
    expect(toInternationalDigits('+91 98765 43210', '91')).toBe('919876543210')
    expect(toInternationalDigits('919876543210', '91')).toBe('919876543210')
    expect(toInternationalDigits('0044 20 7946 0958', '91')).toBe('442079460958')
    expect(toInternationalDigits(919876543210, '91')).toBe('919876543210')
  })
  it('rejects junk', () => {
    expect(toInternationalDigits('', '91')).toBeNull()
    expect(toInternationalDigits('12345', '91')).toBeNull()
    expect(toInternationalDigits({}, '91')).toBeNull()
  })
})

describe('extractExternalId', () => {
  it('finds the id in common response shapes', () => {
    expect(extractExternalId({ id: 42 })).toBe('42')
    expect(extractExternalId({ lead_id: 'L-1' })).toBe('L-1')
    expect(extractExternalId({ data: { id: 'abc' } })).toBe('abc')
    expect(extractExternalId({ lead: { uuid: 'u1' } })).toBe('u1')
    expect(extractExternalId({ success: true, data: { lead: { id: 7 } } })).toBe('7')
    expect(extractExternalId({ success: true })).toBeNull()
    expect(extractExternalId(null)).toBeNull()
  })
})

describe('projects (channel partners)', () => {
  const { options } = parseOptions({
    projects: {
      'The Galleria': { tag: 'p-galleria', welcome: { template: 'galleria_welcome', language: 'en' } },
      'GV-12': { name: 'Green Valley', tag: 'p-green-valley', welcome: 'none' },
      'Sky Towers': { tag: 'p-sky' },
    },
    fallback_welcome: false,
  })

  it('parses project settings keyed by name or code', () => {
    expect(Object.keys(options.projects).sort()).toEqual(['GV_12', 'SKY_TOWERS', 'THE_GALLERIA'])
    expect(options.projects.GV_12).toEqual({ name: 'Green Valley', tag: 'p-green-valley', welcome: 'none' })
    expect(options.fallback_welcome).toBe(false)
  })

  it('rejects a bad template name or tag', () => {
    expect(parseOptions({ projects: { X: { welcome: { template: 'Bad Name!' } } } }).invalid).toContain('projects')
    expect(parseOptions({ projects: { X: { tag: 'x'.repeat(60) } } }).invalid).toContain('projects')
  })

  it('matches a lead on code, tag, id or name', () => {
    expect(matchProject(options.projects, { project_code: 'gv-12' })?.setting.name).toBe('Green Valley')
    expect(matchProject(options.projects, { project: 'the galleria' })?.setting.tag).toBe('p-galleria')
    expect(matchProject(options.projects, { project: 'Unknown', project_code: 'sky towers' })?.key).toBe('SKY_TOWERS')
    expect(matchProject(options.projects, { project: 'Unknown' })).toBeNull()
    expect(leadNamesProject({ project: 'Unknown' })).toBe(true)
    expect(leadNamesProject({})).toBe(false)
  })

  const base = {
    options,
    payloadTemplate: null,
    defaultTemplate: { name: 'default_welcome', language: 'en' },
    alreadyEnquired: false,
  }
  it("sends only the lead's own project welcome — never another project's", () => {
    expect(chooseWelcome({ ...base, project: matchProject(options.projects, { project: 'The Galleria' }) })).toMatchObject({
      kind: 'template',
      template: 'galleria_welcome',
      reason: 'project',
    })
    expect(chooseWelcome({ ...base, project: matchProject(options.projects, { project_code: 'GV-12' }) })).toEqual({
      kind: 'none',
      reason: 'project_none',
    })
    // No welcome of its own and fallback off → nothing, not the default.
    expect(chooseWelcome({ ...base, project: matchProject(options.projects, { project: 'Sky Towers' }) })).toEqual({
      kind: 'none',
      reason: 'no_fallback',
    })
  })

  it('uses the default welcome only when fallback is on', () => {
    const single = parseOptions({}).options
    expect(chooseWelcome({ ...base, options: single, project: null })).toMatchObject({ kind: 'template', reason: 'default' })
  })

  it('does not greet a repeat enquiry for the same project, or an opted-out contact', () => {
    const p = matchProject(options.projects, { project: 'The Galleria' })
    expect(chooseWelcome({ ...base, project: p, alreadyEnquired: true })).toEqual({ kind: 'none', reason: 'already_enquired' })
    expect(chooseWelcome({ ...base, project: p, optedOut: true })).toEqual({ kind: 'none', reason: 'opted_out' })
  })

  it('"never message leads from this source" outranks every template, even a payload one', () => {
    const p = matchProject(options.projects, { project: 'The Galleria' })
    expect(chooseWelcome({ ...base, project: p, noMessage: true })).toEqual({ kind: 'none', reason: 'source_no_message' })
    expect(
      chooseWelcome({ ...base, project: p, noMessage: true, payloadTemplate: { name: 'custom', language: null } }),
    ).toEqual({ kind: 'none', reason: 'source_no_message' })
  })

  it('a template named in the payload always wins (unless opted out)', () => {
    expect(chooseWelcome({ ...base, project: null, payloadTemplate: { name: 'custom', language: null } })).toMatchObject({
      kind: 'template',
      template: 'custom',
      reason: 'payload',
    })
  })

  it("adds the project's tag next to the source and payload tags", () => {
    expect(leadTagNames({ META: 'meta-form' }, 'Meta', ['hot'], ['p-galleria', 'p-galleria'])).toEqual([
      'meta-form',
      'p-galleria',
      'hot',
    ])
  })
})
