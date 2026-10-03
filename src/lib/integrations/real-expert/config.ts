// ============================================================
// DigiExplorer Real Expert CRM — settings shape and validation.
//
// Defaults follow Real Expert's Public API v1 (docs/real-expert-
// integration.md): GET /v1/me, POST /v1/leads,
// POST /v1/leads/{lead_id}/stage and POST /v1/leads/{lead_id}/activities,
// with the key sent as a Bearer token. Paths stay editable per account.
// Pure functions only; safe to import from client components.
// ============================================================

export const REAL_EXPERT_PROVIDER = 'real_expert' as const

export type AuthStyle = 'bearer' | 'x-api-key'

export interface RealExpertOptions {
  auth_style: AuthStyle
  /** POST — create a lead (or get the existing one for that phone). */
  leads_path: string
  /** POST — a deal's stage / status / value on a lead. `{lead_id}` is filled in. */
  stage_path: string
  /** POST — one WhatsApp message on a lead's timeline. `{lead_id}` is filled in. */
  activities_path: string
  /** GET — connection test; returns the workspace the key belongs to. */
  test_path: string
  /** Country code for national numbers sent by Real Expert ("98765 43210"). */
  default_country_code: string
  /** Sent as the lead's source; Real Expert never sends these leads back. */
  lead_source: string
}

export const DEFAULT_OPTIONS: RealExpertOptions = {
  auth_style: 'bearer',
  leads_path: '/api/v1/leads',
  stage_path: '/api/v1/leads/{lead_id}/stage',
  activities_path: '/api/v1/leads/{lead_id}/activities',
  test_path: '/api/v1/me',
  default_country_code: '91',
  lead_source: 'WhatsApp',
}

const PATH_KEYS = ['leads_path', 'stage_path', 'activities_path', 'test_path'] as const

/** A relative API path: starts with "/", no "..", no scheme/host, no query. */
export function isSafePath(path: string): boolean {
  return (
    path.length <= 200 &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('..') &&
    !/[\s?#\\]/.test(path) &&
    // The only placeholder allowed is {lead_id}.
    path.replace(/\{lead_id\}/g, '').search(/[{}]/) === -1
  )
}

/** Fill `{lead_id}` in a path. The id is URL-encoded. */
export function fillPath(path: string, leadId?: string | null): string {
  return path.replace(/\{lead_id\}/g, encodeURIComponent(leadId ?? ''))
}

/**
 * Merge stored/submitted options over the defaults, dropping anything
 * malformed. Returns the cleaned options and the keys that were bad,
 * so the settings API can reject them with a clear message.
 */
export function parseOptions(raw: unknown): { options: RealExpertOptions; invalid: string[] } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const options: RealExpertOptions = { ...DEFAULT_OPTIONS }
  const invalid: string[] = []

  if (src.auth_style !== undefined) {
    if (src.auth_style === 'bearer' || src.auth_style === 'x-api-key') options.auth_style = src.auth_style
    else invalid.push('auth_style')
  }
  for (const key of PATH_KEYS) {
    const v = src[key]
    if (v === undefined || v === '') continue
    if (typeof v === 'string' && isSafePath(v.trim())) options[key] = v.trim().replace(/\/+$/, '')
    else invalid.push(key)
  }
  if (src.default_country_code !== undefined && src.default_country_code !== '') {
    const cc = String(src.default_country_code).replace(/^\+/, '').trim()
    if (/^\d{1,3}$/.test(cc)) options.default_country_code = cc
    else invalid.push('default_country_code')
  }
  if (typeof src.lead_source === 'string' && src.lead_source.trim()) {
    options.lead_source = src.lead_source.trim().slice(0, 60)
  }
  return { options, invalid }
}

/**
 * Normalise the CRM base URL: https only (http allowed for localhost in
 * development), no credentials, query or fragment, no trailing slash.
 * Returns null when unusable.
 */
export function normalizeBaseUrl(raw: string, allowHttpLocalhost = false): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(allowHttpLocalhost && isLocal && url.protocol === 'http:')) return null
  if (url.username || url.password || url.search || url.hash) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Turn a phone number from Real Expert into digits with country code.
 * Accepts "+91 98765 43210", "919876543210", "09876543210" and a bare
 * national "9876543210" (the default country code is added). Returns
 * null for anything that cannot be a real number.
 */
export function toInternationalDigits(raw: unknown, defaultCountryCode: string): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const str = String(raw).trim()
  const hasPlus = str.startsWith('+') || str.startsWith('00')
  let digits = str.replace(/\D/g, '')
  if (str.startsWith('00')) digits = digits.slice(2)
  if (!digits) return null

  if (!hasPlus) {
    // National trunk prefix: 0 98765 43210 → 98765 43210.
    const national = digits.replace(/^0+/, '')
    if (national.length === 10 && defaultCountryCode) {
      digits = `${defaultCountryCode}${national}`
    } else if (national !== digits && defaultCountryCode) {
      digits = `${defaultCountryCode}${national}`
    }
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** Pull an id out of whatever shape Real Expert returns. */
export function extractExternalId(body: unknown, keys: string[] = ['lead_id', 'id', 'leadId', 'uuid']): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null
    const r = o as Record<string, unknown>
    for (const k of keys) {
      const v = r[k]
      if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim()
    }
    return null
  }
  if (!body || typeof body !== 'object') return null
  const r = body as Record<string, unknown>
  return pick(r) ?? pick(r.data) ?? pick(r.lead) ?? pick((r.data as Record<string, unknown> | undefined)?.lead)
}


/** "Site Visit" → "site_visit"; used to compare lead sources loosely. */
export function slugify(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
