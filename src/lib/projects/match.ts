/**
 * Projects (migration 055) — pure matching. No database here, so every
 * routing rule is unit-tested.
 *
 * A channel partner sells several projects from one WhatsApp number.
 * Every lead and message must land on exactly one project, or on none
 * (then the project picker / a person takes over) — never on a wrong
 * one. So the rules are strict and ordered:
 *
 *   1. an explicit project value (code, tag, name) — from a CRM, a form
 *      field, the API;
 *   2. the Meta ad id (Click-to-WhatsApp referral, lead ad);
 *   3. a project keyword in the lead's campaign / ad / form / page /
 *      UTM text, or the ad's headline and link;
 *   4. a project keyword in the customer's WhatsApp message — only when
 *      the caller allows it (first message, or a contact with no
 *      project yet).
 *
 * Within a step, two different projects matching = ambiguous = no
 * project. Keywords match whole words only ("sky" does not match
 * "skyline"), and a longer keyword wins over a shorter one it contains.
 */

export const PROJECT_CATEGORIES = ['residential', 'villa', 'plot', 'commercial', 'mixed', 'other'] as const
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]

export const MAX_PROJECT_KEYWORDS = 30
export const MAX_PROJECT_AD_IDS = 50

export interface Project {
  id: string
  name: string
  code: string | null
  category: ProjectCategory
  tag: string
  keywords: string[]
  ad_ids: string[]
  welcome_mode: 'default' | 'template' | 'none'
  welcome_template: string | null
  welcome_language: string | null
  ai_instructions: string | null
  is_active: boolean
}

export type MatchVia = 'value' | 'ad_id' | 'source_text' | 'message' | 'default'

export interface ProjectMatch {
  project: Project | null
  via: MatchVia | null
  /** Two or more projects matched at the deciding step — none chosen. */
  ambiguous: boolean
}

export interface ProjectSignals {
  /** Explicit project fields: code, tag, id, name — any order. */
  values?: unknown[]
  /** Meta ad id (CTWA referral source_id, lead ad ad_id). */
  adId?: unknown
  /** Campaign, ad set, ad name, form name, page URL, UTM values, ad headline. */
  sourceTexts?: unknown[]
  /** The customer's message — used only when the caller passes it. */
  messageText?: string | null
}

/** Lower-case, accents kept, punctuation and separators folded to single spaces. */
export function foldText(v: string): string {
  return v
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
}

/** Identifier form for exact comparison: "AIS-Galleria " → "ais galleria". */
export const projectKey = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? foldText(String(v)) : ''

const NONE: ProjectMatch = { project: null, via: null, ambiguous: false }

function unique(projects: Project[]): Project[] {
  return [...new Map(projects.map((p) => [p.id, p])).values()]
}

/** Exact match of any value against a project's code, tag, name or id. */
export function matchByValue(projects: Project[], values: unknown[]): ProjectMatch {
  for (const v of values) {
    const key = projectKey(v)
    if (!key) continue
    // Code and tag are unique per workspace; check them before names.
    const byCode = projects.filter((p) => (p.code && projectKey(p.code) === key) || projectKey(p.tag) === key || p.id === String(v).trim())
    const hits = byCode.length > 0 ? unique(byCode) : unique(projects.filter((p) => projectKey(p.name) === key))
    if (hits.length === 1) return { project: hits[0], via: 'value', ambiguous: false }
    if (hits.length > 1) return { project: null, via: null, ambiguous: true }
  }
  return NONE
}

export function matchByAdId(projects: Project[], adId: unknown): ProjectMatch {
  const id = typeof adId === 'string' || typeof adId === 'number' ? String(adId).trim() : ''
  if (!/^\d{3,30}$/.test(id)) return NONE
  const hits = unique(projects.filter((p) => p.ad_ids.includes(id)))
  if (hits.length === 1) return { project: hits[0], via: 'ad_id', ambiguous: false }
  return hits.length > 1 ? { project: null, via: null, ambiguous: true } : NONE
}

/**
 * Whole-word keyword match. When keywords of two projects both match,
 * a keyword that contains the other ("sky heights" vs "sky") decides;
 * otherwise the result is ambiguous.
 */
export function matchByKeywords(projects: Project[], texts: unknown[], via: MatchVia): ProjectMatch {
  const hay = ` ${texts
    .filter((t): t is string | number => typeof t === 'string' || typeof t === 'number')
    .map((t) => foldText(String(t)))
    .filter(Boolean)
    .join(' | ')} `
  if (hay.trim() === '' || hay.trim() === '|') return NONE
  const found: { project: Project; kw: string }[] = []
  for (const p of projects) {
    // The project's name, code and tag count as keywords too (3+
    // characters, so a short code like "A1" can't match by accident).
    const words = [
      ...p.keywords.map(foldText).filter((w) => w.length >= 2),
      ...[p.name, p.code ?? '', p.tag].map(foldText).filter((w) => w.length >= 3),
    ]
    for (const kw of new Set(words)) {
      if (hay.includes(` ${kw} `)) found.push({ project: p, kw })
    }
  }
  if (found.length === 0) return NONE
  // Drop matches whose keyword sits inside a longer matched keyword of
  // another project ("sky" inside "sky heights").
  const kept = found.filter(
    (f) => !found.some((g) => g.project.id !== f.project.id && g.kw.length > f.kw.length && ` ${g.kw} `.includes(` ${f.kw} `)),
  )
  const hits = unique(kept.map((f) => f.project))
  if (hits.length === 1) return { project: hits[0], via, ambiguous: false }
  return { project: null, via: null, ambiguous: true }
}

/** Apply the ordered rules. Inactive projects never match. */
export function resolveProject(all: Project[], signals: ProjectSignals): ProjectMatch {
  const projects = all.filter((p) => p.is_active)
  if (projects.length === 0) return NONE
  const steps: (() => ProjectMatch)[] = [
    () => matchByValue(projects, signals.values ?? []),
    () => matchByAdId(projects, signals.adId),
    () => matchByKeywords(projects, signals.sourceTexts ?? [], 'source_text'),
    () => (signals.messageText ? matchByKeywords(projects, [signals.messageText], 'message') : NONE),
  ]
  for (const step of steps) {
    const m = step()
    // A clear match wins; an ambiguous step stops here rather than
    // letting a weaker signal pick one of the contenders.
    if (m.project || m.ambiguous) return m
  }
  return NONE
}

/** The project whose tag this is (case-insensitive). */
export function projectForTag(projects: Project[], tag: string): Project | null {
  const key = tag.trim().toLowerCase()
  return projects.find((p) => p.tag.toLowerCase() === key) ?? null
}

// ------------------------------------------------------------
// Validation for the settings API
// ------------------------------------------------------------

const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._\-/&]{0,49}$/u
// Real Expert's code rule: 1–60 of letters, digits, . _ - / and space (not starting with a space).
export const CODE_RE = /^[\p{L}\p{N}._\-/][\p{L}\p{N}._\-/ ]{0,59}$/u
const TEMPLATE_RE = /^[a-z0-9_]{1,512}$/
const LANG_RE = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/

export type ProjectInput = Omit<Project, 'id'>

function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []
  return [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))]
}

/** Suggested tag for a project name: "AIS Galleria" → "p-ais-galleria". */
export function suggestTag(name: string): string {
  const slug = foldText(name).replace(/\s+/g, '-').slice(0, 40)
  return slug ? `p-${slug}` : ''
}

/**
 * Validate a create/update body. `partial` = only fields present are
 * checked and returned (PATCH).
 */
export function parseProjectInput(
  body: Record<string, unknown>,
  partial = false,
): { value: Partial<ProjectInput>; errors: string[] } {
  const errors: string[] = []
  const value: Partial<ProjectInput> = {}
  const has = (k: string) => k in body && body[k] !== undefined

  if (!partial || has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 120) errors.push('name')
    else value.name = name
  }
  if (!partial || has('tag')) {
    let tag = typeof body.tag === 'string' ? body.tag.trim() : ''
    if (!tag && !partial && value.name) tag = suggestTag(value.name)
    if (!TAG_RE.test(tag)) errors.push('tag')
    else value.tag = tag
  }
  if (has('code')) {
    const code = body.code === null ? '' : String(body.code).trim()
    if (code && !CODE_RE.test(code)) errors.push('code')
    else value.code = code || null
  }
  if (has('category')) {
    if (!PROJECT_CATEGORIES.includes(body.category as ProjectCategory)) errors.push('category')
    else value.category = body.category as ProjectCategory
  }
  if (has('keywords')) {
    const kws = list(body.keywords).map((k) => k.slice(0, 60))
    if (kws.length > MAX_PROJECT_KEYWORDS || kws.some((k) => foldText(k).length < 2)) errors.push('keywords')
    else value.keywords = kws
  }
  if (has('ad_ids')) {
    const ids = list(body.ad_ids)
    if (ids.length > MAX_PROJECT_AD_IDS || ids.some((id) => !/^\d{3,30}$/.test(id))) errors.push('ad_ids')
    else value.ad_ids = ids
  }
  if (has('welcome_mode')) {
    const mode = body.welcome_mode
    if (mode !== 'default' && mode !== 'template' && mode !== 'none') errors.push('welcome_mode')
    else value.welcome_mode = mode
  }
  if (has('welcome_template')) {
    const t = body.welcome_template === null ? '' : String(body.welcome_template).trim()
    if (t && !TEMPLATE_RE.test(t)) errors.push('welcome_template')
    else value.welcome_template = t || null
  }
  if (has('welcome_language')) {
    const l = body.welcome_language === null ? '' : String(body.welcome_language).trim()
    if (l && !LANG_RE.test(l)) errors.push('welcome_language')
    else value.welcome_language = l || null
  }
  if (value.welcome_mode === 'template' && has('welcome_template') && !value.welcome_template) {
    errors.push('welcome_template')
  }
  if (has('ai_instructions')) {
    const a = body.ai_instructions === null ? '' : String(body.ai_instructions).trim()
    if (a.length > 4000) errors.push('ai_instructions')
    else value.ai_instructions = a || null
  }
  if (has('is_active')) {
    if (typeof body.is_active !== 'boolean') errors.push('is_active')
    else value.is_active = body.is_active
  }
  return { value, errors }
}
