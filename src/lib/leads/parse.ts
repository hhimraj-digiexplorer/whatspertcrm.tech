/**
 * Lead webhooks (migration 055) — turn whatever a lead source POSTs into
 * one shape. Pure, so every format is unit-tested.
 *
 * Accepted bodies:
 *   - flat JSON: { name, phone, email, project, campaign_name, ... }
 *   - nested JSON: { data: {...} } / { lead: {...} } / { contact: {...} }
 *   - Meta lead ads (Graph / Zapier / Make / Pabbly): { field_data:
 *     [{ name, values: [..] }], ad_id, ad_name, form_id, campaign_name }
 *   - a form post (application/x-www-form-urlencoded or multipart)
 *
 * Field names are matched loosely ("Phone Number", "phone_number",
 * "mobile", "whatsapp" …). Anything not recognised is kept in `extra`
 * and shown to the agent as a note.
 */

export interface LeadInput {
  phone: string | null
  name: string | null
  email: string | null
  city: string | null
  message: string | null
  /** Explicit project fields: project code / tag / name / id. */
  projectValues: string[]
  /** Where the lead came from — matched against project keywords. */
  source: string | null
  campaign: string | null
  adset: string | null
  adName: string | null
  adId: string | null
  formName: string | null
  formId: string | null
  pageUrl: string | null
  utm: Record<string, string>
  /** CRM's own lead id, for the note. */
  externalId: string | null
  /** Extra tags the source asks for. */
  tags: string[]
  /** Optional template override: { name, language?, variables? }. */
  template: { name: string; language: string | null; variables: string[] | null } | null
  extra: Record<string, string>
}

const MAX_EXTRA = 30

/** "Phone Number" / "phone-number" / "phoneNumber" → "phone_number". */
export function fieldKey(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const ALIASES: Record<keyof Omit<LeadInput, 'projectValues' | 'utm' | 'tags' | 'template' | 'extra'>, string[]> = {
  phone: ['phone', 'phone_number', 'mobile', 'mobile_number', 'whatsapp', 'whatsapp_number', 'contact_number', 'contact', 'number', 'cell', 'tel', 'telephone'],
  name: ['name', 'full_name', 'fullname', 'customer_name', 'lead_name', 'your_name'],
  email: ['email', 'email_address', 'e_mail', 'your_email'],
  city: ['city', 'location', 'town'],
  message: ['message', 'comments', 'comment', 'notes', 'note', 'query', 'requirement', 'remarks', 'description'],
  source: ['source', 'lead_source', 'platform', 'channel'],
  campaign: ['campaign', 'campaign_name'],
  adset: ['adset', 'adset_name', 'ad_set', 'ad_set_name'],
  adName: ['ad_name', 'ad', 'creative', 'creative_name'],
  adId: ['ad_id'],
  formName: ['form_name', 'form', 'form_title'],
  formId: ['form_id', 'leadgen_form_id'],
  pageUrl: ['page_url', 'url', 'landing_page', 'landing_page_url', 'referrer', 'page', 'source_url', 'website'],
  externalId: ['lead_id', 'leadgen_id', 'external_id', 'enquiry_id', 'id'],
}

const PROJECT_KEYS = ['project_code', 'project_tag', 'project_id', 'project', 'project_name', 'property', 'property_name', 'interested_in', 'interested_project']
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
const FIRST_NAME = ['first_name', 'firstname', 'given_name']
const LAST_NAME = ['last_name', 'lastname', 'surname', 'family_name']
const IGNORE = new Set(['event', 'token', 'secret', 'api_key', 'apikey', 'field_data', 'data', 'lead', 'contact', 'template', 'tags', 'created_time', 'created_at'])

function scalar(v: unknown, max = 300): string | null {
  if (typeof v === 'string') return v.trim() ? v.trim().slice(0, max) : null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v) && v.length > 0) return scalar(v[0], max)
  return null
}

/** Flatten the body into one key → value map (later sources win for blanks only). */
export function flattenLeadBody(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const put = (k: string, v: unknown) => {
    const key = fieldKey(k)
    if (!key) return
    if (out[key] === undefined || out[key] === null || out[key] === '') out[key] = v
  }
  const visit = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return
    const r = o as Record<string, unknown>
    // Meta lead ads: field_data: [{ name, values }]
    if (Array.isArray(r.field_data)) {
      for (const f of r.field_data as unknown[]) {
        if (f && typeof f === 'object') {
          const fd = f as { name?: unknown; values?: unknown; value?: unknown }
          if (typeof fd.name === 'string') put(fd.name, Array.isArray(fd.values) ? fd.values[0] : fd.value)
        }
      }
    }
    for (const [k, v] of Object.entries(r)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) continue
      if (k === 'field_data') continue
      put(k, v)
    }
    for (const key of ['data', 'lead', 'contact', 'payload', 'fields', 'answers']) {
      if (r[key] && typeof r[key] === 'object') visit(r[key], depth + 1)
    }
  }
  visit(body, 0)
  if (body && typeof body === 'object') {
    const r = body as Record<string, unknown>
    if (Array.isArray(r.tags)) out.tags = r.tags
    if (r.template && typeof r.template === 'object') out.template = r.template
  }
  return out
}

export function parseLeadBody(body: unknown): LeadInput {
  const flat = flattenLeadBody(body)
  const used = new Set<string>()
  const pick = (keys: string[], max = 300): string | null => {
    for (const k of keys) {
      const v = scalar(flat[k], max)
      if (v) {
        used.add(k)
        return v
      }
    }
    return null
  }
  const lead = {} as LeadInput
  for (const [field, keys] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
    ;(lead as unknown as Record<string, string | null>)[field] = pick(keys, field === 'message' ? 1000 : 300)
  }
  if (!lead.name) {
    const first = pick(FIRST_NAME, 60)
    const last = pick(LAST_NAME, 60)
    lead.name = [first, last].filter(Boolean).join(' ') || null
  }
  if (lead.name) lead.name = lead.name.slice(0, 120)
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) lead.email = null
  lead.projectValues = PROJECT_KEYS.map((k) => {
    const v = scalar(flat[k], 120)
    if (v) used.add(k)
    return v
  }).filter((v): v is string => !!v)
  lead.utm = {}
  for (const k of UTM_KEYS) {
    const v = scalar(flat[k], 200)
    if (v) {
      lead.utm[k] = v
      used.add(k)
    }
  }
  lead.tags = Array.isArray(flat.tags)
    ? [...new Set((flat.tags as unknown[]).map((t) => scalar(t, 50)).filter((t): t is string => !!t))].slice(0, 10)
    : []
  const tpl = flat.template as Record<string, unknown> | undefined
  const tplName = tpl ? scalar(tpl.name, 512) : null
  lead.template =
    tplName && /^[a-z0-9_]{1,512}$/.test(tplName)
      ? {
          name: tplName,
          language: tpl ? scalar(tpl.language, 20) : null,
          variables: Array.isArray(tpl?.variables) ? (tpl!.variables as unknown[]).map((v) => String(v ?? '').slice(0, 300)) : null,
        }
      : null
  lead.extra = {}
  for (const [k, v] of Object.entries(flat)) {
    if (used.has(k) || IGNORE.has(k) || FIRST_NAME.includes(k) || LAST_NAME.includes(k)) continue
    if (Object.keys(lead.extra).length >= MAX_EXTRA) break
    const s = scalar(v, 300)
    if (s) lead.extra[k] = s
  }
  return lead
}

/** Parse a raw request body by content type. Null = unreadable. */
export function readLeadRequest(rawBody: string, contentType: string | null): unknown {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody))
  }
  try {
    return JSON.parse(rawBody)
  } catch {
    // Some tools post form-encoded bodies without the header.
    if (rawBody.includes('=') && !rawBody.trim().startsWith('{')) return Object.fromEntries(new URLSearchParams(rawBody))
    return null
  }
}

/** Texts that say where the lead came from — matched against project keywords. */
export function leadSourceTexts(lead: LeadInput): string[] {
  return [
    lead.campaign,
    lead.adset,
    lead.adName,
    lead.formName,
    lead.pageUrl,
    lead.utm.utm_campaign,
    lead.utm.utm_content,
    lead.utm.utm_term,
  ].filter((v): v is string => !!v)
}
