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

/**
 * Exchange the signup `code` for a business integration token. The popup
 * flow (JS SDK) passes no redirect_uri; the mobile redirect flow must pass
 * the exact redirect_uri it sent to the OAuth dialog.
 */
export async function exchangeCodeForToken(code: string, redirectUri?: string): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim()
  const secret = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!appId || !secret) throw new EmbeddedSignupConfigError()

  const url = new URL(`${GRAPH}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', secret)
  url.searchParams.set('code', code)
  if (redirectUri) url.searchParams.set('redirect_uri', redirectUri)
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

export class SignupAssetsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignupAssetsError'
  }
}

/**
 * WhatsApp Business Account ids the client shared with our app in this
 * signup, read from the token's granular scopes (debug_token). The
 * redirect flow has no postMessage session info, so this is where the
 * WABA comes from.
 */
export async function sharedWabaIds(accessToken: string): Promise<string[]> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim()
  const secret = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!appId || !secret) throw new EmbeddedSignupConfigError()
  const url = new URL(`${GRAPH}/debug_token`)
  url.searchParams.set('input_token', accessToken)
  url.searchParams.set('access_token', `${appId}|${secret}`)
  const res = await fetch(url, { cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as {
    data?: { granular_scopes?: { scope?: string; target_ids?: string[] }[] }
    error?: { message?: string }
  }
  if (!res.ok || !body.data) {
    throw new Error(body.error?.message || `debug_token failed (HTTP ${res.status})`)
  }
  const ids = new Set<string>()
  for (const g of body.data.granular_scopes ?? []) {
    if (g.scope === 'whatsapp_business_management' || g.scope === 'whatsapp_business_messaging') {
      for (const id of g.target_ids ?? []) if (/^\d+$/.test(id)) ids.add(id)
    }
  }
  return [...ids]
}

/**
 * Picks the one WABA + phone number from what the client shared. More
 * than one candidate is ambiguous, so the client is asked to finish on a
 * computer (where the popup reports the exact pair).
 */
export function pickSignupPair(
  candidates: { wabaId: string; phoneIds: string[] }[],
): { wabaId: string; phoneNumberId: string } {
  const withNumbers = candidates.filter((c) => c.phoneIds.length > 0)
  if (withNumbers.length === 0) {
    throw new SignupAssetsError('Meta did not share a WhatsApp number with us. Please run the signup again and add a number.')
  }
  const pairs = withNumbers.flatMap((c) => c.phoneIds.map((p) => ({ wabaId: c.wabaId, phoneNumberId: p })))
  if (pairs.length > 1) {
    throw new SignupAssetsError(
      'More than one WhatsApp number was shared. Please finish the signup on a computer so we connect the right one.',
    )
  }
  return pairs[0]
}

/** A random 6-digit two-step verification PIN for /register. */
export function generateTwoStepPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
