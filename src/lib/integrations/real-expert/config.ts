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
  /**
   * Tags given to leads Real Expert pushes in, by lead source:
   * { "META": "meta-form", "WEBSITE": "website" }. Keys are normalised
   * with `sourceKey`; values are tag names (created if missing).
   */
  source_tags: Record<string, string>
  /**
   * Who greets a new Real Expert lead: Whatspert (the welcome template)
   * or Real Expert itself (partner `send`). Only one should, so a lead is
   * never greeted twice.
   */
  greeting_by: GreetingBy
  /**
   * Channel partners sell several projects from one number. Per project
   * (keyed by `sourceKey` of its name, code or tag): the tag a lead for
   * it gets, and its own welcome — a template, or 'none' when the
   * project's own automation greets.
   */
  projects: Record<string, ProjectSetting>
  /**
   * Send the account's default welcome template when a lead's project has
   * no welcome of its own (or the lead names no project). Turn off for
   * multi-project accounts so a buyer never gets another project's welcome.
   */
  fallback_welcome: boolean
}

export type GreetingBy = 'whatspert' | 'real_expert'

export interface ProjectSetting {
  /** Display name, as typed in settings. */
  name: string
  /** Tag every lead for this project gets (created if missing). */
  tag?: string
  /** Welcome for this project: an approved template, or 'none'. Unset = fallback. */
  welcome?: { template: string; language?: string } | 'none'
  /** Real Expert's project code, sent back on leads, enquiries and stage syncs. */
  code?: string
  /**
   * Click-to-WhatsApp ads for this project: a Meta ad id (digits) or a
   * word that appears in the ad's headline, text or link. A contact who
   * writes from a matching ad gets this project's tag before any flow runs.
   */
  ads?: string[]
}

export const MAX_PROJECTS = 50
export const MAX_PROJECT_ADS = 20
const PROJECT_CODE_RE = /^[\w.\-/ ]{1,60}$/

export const DEFAULT_OPTIONS: RealExpertOptions = {
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
}

export const MAX_SOURCE_TAGS = 30
export const MAX_TAG_NAME = 50

/** Normalise a lead source for matching: "Google Ads" → "GOOGLE_ADS". */
export function sourceKey(source: string): string {
  return source.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

/** A tag name we accept from settings or a payload, or null. */
export function cleanTagName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const name = v.trim().replace(/\s+/g, ' ')
  return name && name.length <= MAX_TAG_NAME ? name : null
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
  const options: RealExpertOptions = { ...DEFAULT_OPTIONS, source_tags: {}, projects: {} }
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
  if (src.source_tags !== undefined && src.source_tags !== null) {
    const map = src.source_tags
    if (typeof map !== 'object' || Array.isArray(map)) {
      invalid.push('source_tags')
    } else {
      const entries = Object.entries(map as Record<string, unknown>)
      let bad = entries.length > MAX_SOURCE_TAGS
      for (const [k, v] of entries.slice(0, MAX_SOURCE_TAGS)) {
        const key = sourceKey(k)
        if (!key) continue
        if (v === '' || v === null) continue
        const tag = cleanTagName(v)
        if (!tag) {
          bad = true
          continue
        }
        options.source_tags[key] = tag
      }
      if (bad) invalid.push('source_tags')
    }
  }
  if (src.greeting_by !== undefined) {
    if (src.greeting_by === 'whatspert' || src.greeting_by === 'real_expert') options.greeting_by = src.greeting_by
    else invalid.push('greeting_by')
  }
  if (src.fallback_welcome !== undefined) {
    if (typeof src.fallback_welcome === 'boolean') options.fallback_welcome = src.fallback_welcome
    else invalid.push('fallback_welcome')
  }
  if (src.projects !== undefined && src.projects !== null) {
    const parsed = parseProjects(src.projects)
    options.projects = parsed.projects
    if (parsed.bad) invalid.push('projects')
  }
  return { options, invalid }
}

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/
const LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/

function parseProjects(raw: unknown): { projects: Record<string, ProjectSetting>; bad: boolean } {
  const projects: Record<string, ProjectSetting> = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return { projects, bad: true }
  const entries = Object.entries(raw as Record<string, unknown>)
  let bad = entries.length > MAX_PROJECTS
  for (const [k, v] of entries.slice(0, MAX_PROJECTS)) {
    const key = sourceKey(k)
    if (!key || !v || typeof v !== 'object' || Array.isArray(v)) {
      bad = true
      continue
    }
    const r = v as Record<string, unknown>
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : k.trim().slice(0, 120)
    const setting: ProjectSetting = { name }
    if (r.tag !== undefined && r.tag !== null && r.tag !== '') {
      const tag = cleanTagName(r.tag)
      if (tag) setting.tag = tag
      else bad = true
    }
    if (r.welcome === 'none') setting.welcome = 'none'
    else if (r.welcome && typeof r.welcome === 'object') {
      const w = r.welcome as Record<string, unknown>
      const template = typeof w.template === 'string' ? w.template.trim() : ''
      const language = typeof w.language === 'string' ? w.language.trim() : ''
      if (TEMPLATE_NAME_RE.test(template) && (!language || LANGUAGE_RE.test(language))) {
        setting.welcome = language ? { template, language } : { template }
      } else bad = true
    } else if (r.welcome !== undefined && r.welcome !== null && r.welcome !== '') bad = true
    if (r.code !== undefined && r.code !== null && r.code !== '') {
      const code = String(r.code).trim()
      if (PROJECT_CODE_RE.test(code)) setting.code = code
      else bad = true
    }
    if (r.ads !== undefined && r.ads !== null) {
      const list = Array.isArray(r.ads) ? r.ads : typeof r.ads === 'string' ? r.ads.split(',') : null
      if (!list) bad = true
      else {
        const ads = [...new Set(list.map((a) => String(a ?? '').trim().slice(0, 120)).filter(Boolean))]
        if (ads.length > MAX_PROJECT_ADS) bad = true
        if (ads.length > 0) setting.ads = ads.slice(0, MAX_PROJECT_ADS)
      }
    }
    projects[key] = setting
  }
  return { projects, bad }
}

/** The project fields a Real Expert lead push may carry. */
export interface LeadProjectFields {
  project?: unknown
  project_id?: unknown
  project_code?: unknown
  project_tag?: unknown
}

/**
 * The configured project a lead is for, matched on its code, tag, id or
 * name (in that order). Null when the lead names no configured project.
 */
export function matchProject(
  projects: Record<string, ProjectSetting>,
  lead: LeadProjectFields,
): { key: string; setting: ProjectSetting } | null {
  for (const v of [lead.project_code, lead.project_tag, lead.project_id, lead.project]) {
    if ((typeof v !== 'string' || !v.trim()) && typeof v !== 'number') continue
    const key = sourceKey(String(v))
    if (!key) continue
    if (projects[key]) return { key, setting: projects[key] }
    // A project keyed by its name still matches on its saved code or tag.
    for (const [k, setting] of Object.entries(projects)) {
      if ((setting.code && sourceKey(setting.code) === key) || (setting.tag && sourceKey(setting.tag) === key)) {
        return { key: k, setting }
      }
    }
  }
  return null
}

/** What Meta sends with a message that came from a Click-to-WhatsApp ad. */
export interface AdReferral {
  source_id?: string
  source_type?: string
  source_url?: string
  headline?: string
  body?: string
  ctwa_clid?: string
}

/**
 * The project whose ad list matches this referral: an all-digit entry
 * must equal the ad id; any other entry is a word looked for
 * (case-insensitive) in the ad's headline, text and link.
 */
export function projectForReferral(
  projects: Record<string, ProjectSetting>,
  referral: AdReferral | null | undefined,
): { key: string; setting: ProjectSetting } | null {
  if (!referral) return null
  const adId = (referral.source_id ?? '').trim()
  const haystack = [referral.headline, referral.body, referral.source_url]
    .filter((v): v is string => typeof v === 'string')
    .join(' \n ')
    .toLowerCase()
  // Ad ids first (exact), then words — so an id match is never beaten
  // by another project's broader keyword.
  for (const [key, setting] of Object.entries(projects)) {
    if (adId && (setting.ads ?? []).some((a) => /^\d+$/.test(a) && a === adId)) return { key, setting }
  }
  for (const [key, setting] of Object.entries(projects)) {
    if ((setting.ads ?? []).some((a) => !/^\d+$/.test(a) && haystack.includes(a.toLowerCase()))) {
      return { key, setting }
    }
  }
  return null
}

/** The configured project whose tag is one of these (case-insensitive). */
export function projectForTags(
  projects: Record<string, ProjectSetting>,
  tagNames: string[],
): { key: string; setting: ProjectSetting } | null {
  const wanted = new Set(tagNames.map((n) => n.trim().toLowerCase()))
  for (const [key, setting] of Object.entries(projects)) {
    if (setting.tag && wanted.has(setting.tag.toLowerCase())) return { key, setting }
  }
  return null
}

/** Every configured project tag. */
export function projectTagNames(projects: Record<string, ProjectSetting>): string[] {
  return [...new Set(Object.values(projects).map((p) => p.tag).filter((t): t is string => !!t))]
}

/** Does the lead name any project at all (configured or not)? */
export function leadNamesProject(lead: LeadProjectFields): boolean {
  return [lead.project_code, lead.project_tag, lead.project_id, lead.project].some(
    (v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number',
  )
}

export type WelcomeChoice =
  | { kind: 'template'; template: string; language: string | null; reason: 'payload' | 'project' | 'default' }
  | { kind: 'none'; reason: 'real_expert_greets' | 'project_none' | 'no_fallback' | 'no_template' | 'already_enquired' | 'opted_out' }

/**
 * Which welcome a pushed lead gets. Never another project's: a project
 * with its own setting uses it; otherwise the account default only when
 * `fallback_welcome` is on.
 */
export function chooseWelcome(args: {
  options: RealExpertOptions
  payloadTemplate: { name: string; language: string | null } | null
  project: { key: string; setting: ProjectSetting } | null
  defaultTemplate: { name: string | null; language: string | null }
  alreadyEnquired: boolean
  /** The contact sent STOP — no welcome at all, not even a named one. */
  optedOut?: boolean
}): WelcomeChoice {
  const { options, payloadTemplate, project, defaultTemplate, alreadyEnquired } = args
  if (args.optedOut) return { kind: 'none', reason: 'opted_out' }
  if (payloadTemplate) return { kind: 'template', template: payloadTemplate.name, language: payloadTemplate.language, reason: 'payload' }
  if (options.greeting_by !== 'whatspert') return { kind: 'none', reason: 'real_expert_greets' }
  if (alreadyEnquired) return { kind: 'none', reason: 'already_enquired' }
  const w = project?.setting.welcome
  if (w === 'none') return { kind: 'none', reason: 'project_none' }
  if (w) return { kind: 'template', template: w.template, language: w.language ?? null, reason: 'project' }
  if (!options.fallback_welcome) return { kind: 'none', reason: 'no_fallback' }
  if (!defaultTemplate.name) return { kind: 'none', reason: 'no_template' }
  return { kind: 'template', template: defaultTemplate.name, language: defaultTemplate.language, reason: 'default' }
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

/**
 * Tag names for an incoming lead: the tag mapped to its source, then any
 * in the payload's `tags`, de-duplicated (case-insensitive), max 10.
 */
export function leadTagNames(
  sourceTags: Record<string, string>,
  source: string | null,
  payloadTags: unknown,
  /** The project's tag (settings) and/or the payload's `project_tag`. */
  projectTags: unknown[] = [],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v: unknown) => {
    const name = cleanTagName(v)
    if (!name || seen.has(name.toLowerCase()) || out.length >= 10) return
    seen.add(name.toLowerCase())
    out.push(name)
  }
  if (source) push(sourceTags[sourceKey(source)])
  projectTags.forEach(push)
  if (Array.isArray(payloadTags)) payloadTags.forEach(push)
  else if (typeof payloadTags === 'string') payloadTags.split(',').forEach(push)
  return out
}
