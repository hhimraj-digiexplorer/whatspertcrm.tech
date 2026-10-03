// Shared helpers for the Real Expert settings and inbound routes.

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Secret Real Expert sends with each inbound lead. */
export function generateInboundToken(): string {
  return `rex_${randomBytes(24).toString('base64url')}`
}

export function tokensMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
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
