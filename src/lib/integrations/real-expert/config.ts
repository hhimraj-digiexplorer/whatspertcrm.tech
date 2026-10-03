// ============================================================
// DigiExplorer Real Expert CRM — settings shape and validation.
//
// Real Expert's endpoints are configurable per account (paths, auth
// header) so the integration keeps working if its API moves, and so
// one Whatspert install can point at staging and production CRMs.
// Pure functions only; safe to import from client components.
// ============================================================

export const REAL_EXPERT_PROVIDER = 'real_expert' as const

export type AuthStyle = 'bearer' | 'x-api-key'

export interface RealExpertOptions {
  auth_style: AuthStyle
  /** POST — create a lead. */
  leads_path: string
  /** POST — push a deal's stage / status / value onto a lead. */
  deal_path: string
  /** POST — log one WhatsApp message on a lead's timeline. */
  message_path: string
  /** GET — any authenticated endpoint; used by "Test connection". */
  test_path: string
  /** Country code for national numbers sent by Real Expert ("98765 43210"). */
  default_country_code: string
  /** Shown as the lead source in Real Expert. */
  lead_source: string
}

export const DEFAULT_OPTIONS: RealExpertOptions = {
  auth_style: 'bearer',
  leads_path: '/api/v1/leads',
  deal_path: '/api/v1/leads/{lead_id}/stage',
  message_path: '/api/v1/leads/{lead_id}/activities',
  test_path: '/api/v1/me',
  default_country_code: '91',
  lead_source: 'WhatsApp',
}

const PATH_KEYS = ['leads_path', 'deal_path', 'message_path', 'test_path'] as const

/** A relative API path: starts with "/", no "..", no scheme/host, no query. */
export function isSafePath(path: string): boolean {
  return (
    path.length <= 200 &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('..') &&
    !/[\s?#\\]/.test(path)
  )
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
    if (typeof v === 'string' && isSafePath(v.trim())) options[key] = v.trim()
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

/** Fill `{lead_id}` in a path. The id is URL-encoded. */
export function fillPath(path: string, leadId?: string | null): string {
  return path.replace('{lead_id}', encodeURIComponent(leadId ?? ''))
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

/** Pull the lead id out of whatever shape Real Expert returns. */
export function extractExternalId(body: unknown): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null
    const r = o as Record<string, unknown>
    for (const k of ['lead_id', 'id', 'leadId', 'uuid']) {
      const v = r[k]
      if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim()
    }
    return null
  }
  if (!body || typeof body !== 'object') return null
  const r = body as Record<string, unknown>
  return pick(r) ?? pick(r.data) ?? pick(r.lead) ?? pick((r.data as Record<string, unknown> | undefined)?.lead)
}
