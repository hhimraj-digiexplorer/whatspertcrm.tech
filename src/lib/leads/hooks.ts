import { createHash, randomBytes } from 'crypto'

import { decrypt } from '@/lib/whatsapp/encryption'

import type { LeadHook } from './intake'

/** A new secret for a lead webhook URL ("lw_" + 32 url-safe chars). */
export function generateLeadToken(): string {
  return `lw_${randomBytes(24).toString('base64url')}`
}

export function hashLeadToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const leadHookPath = (token: string) => `/api/leads/${token}`

export const LEAD_TOKEN_RE = /^lw_[A-Za-z0-9_-]{20,64}$/

export const LEAD_HOOK_COLUMNS =
  'id, account_id, name, default_project_id, tags, send_welcome, welcome_template, welcome_language, default_country_code, is_active, leads_received, last_received_at, last_error, created_at'

export function toLeadHook(row: Record<string, unknown>): LeadHook {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    name: String(row.name ?? 'Lead source'),
    default_project_id: (row.default_project_id as string | null) ?? null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    send_welcome: row.send_welcome !== false,
    welcome_template: (row.welcome_template as string | null) ?? null,
    welcome_language: (row.welcome_language as string | null) ?? null,
    default_country_code: String(row.default_country_code ?? '91'),
  }
}

/** Validate a lead-source settings body (create or update). */
export function parseLeadHookInput(
  body: Record<string, unknown>,
  partial = false,
): { value: Record<string, unknown>; errors: string[] } {
  const errors: string[] = []
  const value: Record<string, unknown> = {}
  const has = (k: string) => k in body && body[k] !== undefined
  if (!partial || has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) errors.push('name')
    else value.name = name
  }
  if (has('default_project_id')) {
    const v = body.default_project_id
    if (v === null || v === '') value.default_project_id = null
    else if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) value.default_project_id = v
    else errors.push('default_project_id')
  }
  if (has('tags')) {
    const raw = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(',') : null
    const tags = raw ? [...new Set(raw.map((t) => String(t ?? '').trim()).filter(Boolean))] : null
    if (!tags || tags.length > 10 || tags.some((t) => t.length > 50)) errors.push('tags')
    else value.tags = tags
  }
  if (has('send_welcome')) {
    if (typeof body.send_welcome !== 'boolean') errors.push('send_welcome')
    else value.send_welcome = body.send_welcome
  }
  if (has('welcome_template')) {
    const t = body.welcome_template === null ? '' : String(body.welcome_template).trim()
    if (t && !/^[a-z0-9_]{1,512}$/.test(t)) errors.push('welcome_template')
    else value.welcome_template = t || null
  }
  if (has('welcome_language')) {
    const l = body.welcome_language === null ? '' : String(body.welcome_language).trim()
    if (l && !/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(l)) errors.push('welcome_language')
    else value.welcome_language = l || null
  }
  if (has('default_country_code')) {
    const cc = String(body.default_country_code ?? '').replace(/\D/g, '')
    if (!/^\d{1,3}$/.test(cc)) errors.push('default_country_code')
    else value.default_country_code = cc
  }
  if (has('is_active')) {
    if (typeof body.is_active !== 'boolean') errors.push('is_active')
    else value.is_active = body.is_active
  }
  return { value, errors }
}

/** Row for the settings page, with its URL path (admins only). */
export function presentHook(row: Record<string, unknown>) {
  let path: string | null = null
  try {
    path = leadHookPath(decrypt(String(row.token_enc)))
  } catch {
    path = null
  }
  const { token_enc: _enc, token_hash: _hash, ...rest } = row
  void _enc
  void _hash
  return { ...rest, path }
}

