import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  extractExternalId,
  fillPath,
  isSafePath,
  normalizeBaseUrl,
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
  it('fills defaults', () => {
    expect(parseOptions(undefined)).toEqual({ options: DEFAULT_OPTIONS, invalid: [] })
  })
  it('accepts valid overrides and reports bad ones', () => {
    const { options, invalid } = parseOptions({
      auth_style: 'x-api-key',
      leads_path: '/leads',
      deal_path: 'https://evil.com/x',
      message_path: '/a/../b',
      default_country_code: '+971',
    })
    expect(options.auth_style).toBe('x-api-key')
    expect(options.leads_path).toBe('/leads')
    expect(options.deal_path).toBe(DEFAULT_OPTIONS.deal_path)
    expect(options.default_country_code).toBe('971')
    expect(invalid).toEqual(['deal_path', 'message_path'])
  })
})

describe('isSafePath / fillPath', () => {
  it('only allows plain relative paths', () => {
    expect(isSafePath('/api/v1/leads')).toBe(true)
    expect(isSafePath('//evil.com')).toBe(false)
    expect(isSafePath('/x?y=1')).toBe(false)
    expect(isSafePath('api/v1')).toBe(false)
  })
  it('url-encodes the lead id', () => {
    expect(fillPath('/leads/{lead_id}/stage', 'a/b c')).toBe('/leads/a%2Fb%20c/stage')
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
