// Shared helpers for the Real Expert settings and inbound routes.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** Secret Real Expert sends with each inbound lead. */
export function generateInboundToken(): string {
  return `rex_${randomBytes(24).toString('base64url')}`
}

export function tokensMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Real Expert webhook signature: hex HMAC-SHA256 of the raw body. */
export function signatureMatches(rawBody: string, secret: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return tokensMatch(signature.toLowerCase().replace(/^sha256=/, ''), expected)
}

/** "sk_live_abcd1234" → "••••1234". */
export function maskSecret(secret: string): string {
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`
}

export function inboundPath(integrationId: string): string {
  return `/api/integrations/real-expert/inbound/${integrationId}`
}

/** Number of distinct {{n}} placeholders in a template body. */
export function countPlaceholders(body: string | null | undefined): number {
  if (!body) return 0
  const seen = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => m[1]))
  return seen.size
}

/** Unambiguous characters only (no 0/O, 1/I/L). */
const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** One-time code like "K7QM-4XTB" linking an existing account to Real Expert. */
export function generateLinkCode(): string {
  const chars = Array.from({ length: 8 }, () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}
