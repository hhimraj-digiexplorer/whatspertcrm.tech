// ============================================================
// DigiExplorer Real Expert CRM — settings shape and validation.
//
// Defaults match Real Expert's REST API (`/api/v1`, `X-API-Key`
// header): leads, deals with fixed stage slugs, and activities. Paths
// stay editable per account so a customised install keeps working.
// Pure functions only; safe to import from client components.
// ============================================================

export const REAL_EXPERT_PROVIDER = 'real_expert' as const

export type AuthStyle = 'bearer' | 'x-api-key'

export interface RealExpertOptions {
  auth_style: AuthStyle
  /** POST — create a lead. */
  leads_path: string
  /** POST creates a deal; PUT {deals_path}/{id} updates it; GET {deals_path}/stages lists stages. */
  deals_path: string
  /** POST — log an activity on a lead. */
  activities_path: string
  /** GET — any authenticated endpoint; used by "Test connection". */
  test_path: string
  /** Activity type used for WhatsApp messages (Real Expert: call, sms, email, note, …). */
  message_activity_type: string
  /**
   * Whatspert stage name → Real Expert stage slug, for stages whose
   * names differ. Matching names ("Showing" ↔ showing) need no entry.
   */
  stage_map: Record<string, string>
  /** Country code for national numbers sent by Real Expert ("98765 43210"). */
  default_country_code: string
  /** Shown as the lead source in Real Expert. */
  lead_source: string
}

export const DEFAULT_OPTIONS: RealExpertOptions = {
  auth_style: 'x-api-key',
  leads_path: '/api/v1/leads',
  deals_path: '/api/v1/deals',
  activities_path: '/api/v1/activities',
  test_path: '/api/v1/stats',
  message_activity_type: 'sms',
  stage_map: {},
  default_country_code: '91',
  lead_source: 'WhatsApp',
}

const PATH_KEYS = ['leads_path', 'deals_path', 'activities_path', 'test_path'] as const

/** A relative API path: starts with "/", no "..", no scheme/host, no query. */
export function isSafePath(path: string): boolean {
  return (
    path.length <= 200 &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('..') &&
    !/[\s?#\\{}]/.test(path)
  )
}

const SLUG_RE = /^[a-z0-9_]{1,50}$/

/** "Site Visit" → "site_visit": Real Expert's slug style. */
export function slugify(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Parse the stage mapping, given either as an object or as text with
 * one "Whatspert stage = real_expert_slug" per line. Keys are matched
 * case-insensitively. Returns null when any line is malformed.
 */
export function parseStageMap(raw: unknown): Record<string, string> | null {
  const out: Record<string, string> = {}
  const add = (k: unknown, v: unknown): boolean => {
    if (typeof k !== 'string' || typeof v !== 'string') return false
    const key = k.trim().toLowerCase()
    const slug = v.trim().toLowerCase()
    if (!key || key.length > 100 || !SLUG_RE.test(slug)) return false
    out[key] = slug
    return true
  }
  if (raw === undefined || raw === null || raw === '') return out
  if (typeof raw === 'string') {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const i = line.indexOf('=')
      if (i < 0 || !add(line.slice(0, i), line.slice(i + 1))) return null
    }
    return out
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!add(k, v)) return null
    }
    return Object.keys(out).length > 50 ? null : out
  }
  return null
}

/** Text form of a stage map, for the settings textarea. */
export function stageMapToText(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n')
}

/**
 * Merge stored/submitted options over the defaults, dropping anything
 * malformed. Returns the cleaned options and the keys that were bad,
 * so the settings API can reject them with a clear message.
 */
export function parseOptions(raw: unknown): { options: RealExpertOptions; invalid: string[] } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const options: RealExpertOptions = { ...DEFAULT_OPTIONS, stage_map: {} }
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
  if (src.message_activity_type !== undefined && src.message_activity_type !== '') {
    const t = String(src.message_activity_type).trim().toLowerCase()
    if (SLUG_RE.test(t)) options.message_activity_type = t
    else invalid.push('message_activity_type')
  }
  const map = parseStageMap(src.stage_map)
  if (map) options.stage_map = map
  else invalid.push('stage_map')
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

/** Real Expert ids are integers; send them as numbers when they are. */
export function apiId(id: string): string | number {
  return /^\d{1,15}$/.test(id) ? Number(id) : id
}

/** "Asha Verma" → first/last; Real Expert requires both. */
export function splitName(name: string | null | undefined, phone: string): { first_name: string; last_name: string } {
  const clean = (name ?? '').trim()
  if (!clean || clean.replace(/\D/g, '') === phone.replace(/\D/g, '')) {
    return { first_name: 'WhatsApp', last_name: `+${phone.replace(/\D/g, '')}` }
  }
  const parts = clean.split(/\s+/)
  if (parts.length === 1) return { first_name: parts[0].slice(0, 255), last_name: '-' }
  return { first_name: parts[0].slice(0, 255), last_name: parts.slice(1).join(' ').slice(0, 255) }
}

/**
 * Real Expert stage slug for a Whatspert deal: won/lost win, then the
 * explicit map, then a stage whose slug or label matches the name.
 * Null when nothing matches — the stage is then left unchanged.
 */
export function resolveStageSlug(
  dealStatus: string | null,
  stageName: string | null,
  stageMap: Record<string, string>,
  available: Record<string, string> | null,
): string | null {
  const has = (slug: string) => !available || slug in available
  if (dealStatus === 'won' && has('closed_won')) return 'closed_won'
  if (dealStatus === 'lost' && has('closed_lost')) return 'closed_lost'
  if (!stageName) return null
  const mapped = stageMap[stageName.trim().toLowerCase()]
  if (mapped && has(mapped)) return mapped
  const slug = slugify(stageName)
  if (available) {
    if (slug in available) return slug
    for (const [s, label] of Object.entries(available)) {
      if (slugify(label) === slug) return s
    }
    return null
  }
  return null
}
