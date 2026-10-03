// ============================================================
// WhatsApp Embedded Signup (Meta Tech Provider onboarding).
//
// The browser opens Meta's signup popup (Facebook JS SDK, FB.login with
// the Embedded Signup configuration id). When the client finishes,
// Meta posts the new WABA id and phone number id to our window and the
// login callback returns a short-lived `code`. The server exchanges that
// code for a business integration token and connects the number.
//
// Env:
//   NEXT_PUBLIC_META_APP_ID            Meta app id (public)
//   NEXT_PUBLIC_META_ES_CONFIG_ID      Embedded Signup configuration id
//                                      (Meta App Dashboard → WhatsApp →
//                                      Embedded Signup → Configurations)
//   META_APP_SECRET                    the app secret (first entry if a
//                                      comma-separated list)
// ============================================================

import { randomInt } from 'node:crypto'
import { parseAppSecrets } from './webhook-signature'

const GRAPH = 'https://graph.facebook.com/v21.0'

export { parseEmbeddedSignupMessage, type EmbeddedSignupEvent } from './embedded-signup-message'

export class EmbeddedSignupConfigError extends Error {
  constructor() {
    super('Embedded Signup is not configured (NEXT_PUBLIC_META_APP_ID / META_APP_SECRET)')
    this.name = 'EmbeddedSignupConfigError'
  }
}

/** Exchange the popup's `code` for a business integration token. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim()
  const secret = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!appId || !secret) throw new EmbeddedSignupConfigError()

  const url = new URL(`${GRAPH}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', secret)
  url.searchParams.set('code', code)
  const res = await fetch(url, { cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: { message?: string }
  }
  if (!res.ok || !body.access_token) {
    throw new Error(body.error?.message || `Token exchange failed (HTTP ${res.status})`)
  }
  return body.access_token
}

/** A random 6-digit two-step verification PIN for /register. */
export function generateTwoStepPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
