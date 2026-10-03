import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  extractExternalId,
  isSafePath,
  normalizeBaseUrl,
  parseStageMap,
  resolveStageSlug,
  splitName,
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
  it('fills defaults matching the Real Expert API', () => {
    const { options, invalid } = parseOptions(undefined)
    expect(invalid).toEqual([])
    expect(options).toEqual(DEFAULT_OPTIONS)
    expect(options.auth_style).toBe('x-api-key')
    expect(options.leads_path).toBe('/api/v1/leads')
  })
  it('accepts valid overrides and reports bad ones', () => {
    const { options, invalid } = parseOptions({
      auth_style: 'bearer',
      leads_path: '/leads/',
      deals_path: 'https://evil.com/x',
      activities_path: '/a/../b',
      default_country_code: '+971',
      message_activity_type: 'Note',
      stage_map: 'Site visit = showing',
    })
    expect(options.auth_style).toBe('bearer')
    expect(options.leads_path).toBe('/leads')
    expect(options.deals_path).toBe(DEFAULT_OPTIONS.deals_path)
    expect(options.default_country_code).toBe('971')
    expect(options.message_activity_type).toBe('note')
    expect(options.stage_map).toEqual({ 'site visit': 'showing' })
    expect(invalid).toEqual(['deals_path', 'activities_path'])
  })
  it('rejects a malformed stage map', () => {
    expect(parseOptions({ stage_map: 'no equals sign' }).invalid).toEqual(['stage_map'])
    expect(parseStageMap({ Visit: 'Not A Slug!' })).toBeNull()
  })
})

describe('isSafePath', () => {
  it('only allows plain relative paths', () => {
    expect(isSafePath('/api/v1/leads')).toBe(true)
    expect(isSafePath('//evil.com')).toBe(false)
    expect(isSafePath('/x?y=1')).toBe(false)
    expect(isSafePath('api/v1')).toBe(false)
  })
})

describe('splitName', () => {
  it('splits into the first/last names Real Expert requires', () => {
    expect(splitName('Asha Verma', '919876543210')).toEqual({ first_name: 'Asha', last_name: 'Verma' })
    expect(splitName('Asha Devi Verma', '91')).toEqual({ first_name: 'Asha', last_name: 'Devi Verma' })
    expect(splitName('Asha', '91')).toEqual({ first_name: 'Asha', last_name: '-' })
    expect(splitName(null, '919876543210')).toEqual({ first_name: 'WhatsApp', last_name: '+919876543210' })
    expect(splitName('919876543210', '919876543210').first_name).toBe('WhatsApp')
  })
})

describe('resolveStageSlug', () => {
  const stages = { lead: 'Lead', showing: 'Showing', offer_received: 'Offer Received', closed_won: 'Closed Won', closed_lost: 'Closed Lost' }
  it('maps won/lost, explicit entries, and matching names', () => {
    expect(resolveStageSlug('won', 'Anything', {}, stages)).toBe('closed_won')
    expect(resolveStageSlug('lost', null, {}, stages)).toBe('closed_lost')
    expect(resolveStageSlug('open', 'Site Visit', { 'site visit': 'showing' }, stages)).toBe('showing')
    expect(resolveStageSlug('open', 'Offer received', {}, stages)).toBe('offer_received')
    expect(resolveStageSlug('open', 'Showing', {}, stages)).toBe('showing')
  })
  it('returns null when nothing matches or the stage is unknown', () => {
    expect(resolveStageSlug('open', 'Follow up', {}, stages)).toBeNull()
    expect(resolveStageSlug('open', 'Visit', { visit: 'nope' }, stages)).toBeNull()
    expect(resolveStageSlug('open', 'Showing', {}, null)).toBeNull()
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
