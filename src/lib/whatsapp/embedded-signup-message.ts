// Parser for the postMessage events Meta's Embedded Signup popup sends.
// Kept separate from embedded-signup.ts (server-only: node:crypto) so the
// browser can import it.

export type EmbeddedSignupEvent =
  | { type: 'finish'; phoneNumberId: string; wabaId: string; coexistence: boolean }
  | { type: 'finish_waba_only'; wabaId: string }
  | { type: 'cancel'; step: string | null }
  | { type: 'error'; message: string | null }

/**
 * Read a `message` event posted by Meta's signup popup. Returns null for
 * anything that isn't an Embedded Signup message from facebook.com.
 */
export function parseEmbeddedSignupMessage(origin: string, raw: unknown): EmbeddedSignupEvent | null {
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return null
  }
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return null

  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object') return null
  const msg = data as { type?: string; event?: string; data?: Record<string, unknown> }
  if (msg.type !== 'WA_EMBEDDED_SIGNUP') return null
  const d = msg.data ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

  switch (msg.event) {
    case 'FINISH':
    case 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING': {
      const phoneNumberId = str(d.phone_number_id)
      const wabaId = str(d.waba_id)
      if (!phoneNumberId || !wabaId) return null
      return {
        type: 'finish',
        phoneNumberId,
        wabaId,
        coexistence: msg.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      }
    }
    case 'FINISH_ONLY_WABA': {
      const wabaId = str(d.waba_id)
      return wabaId ? { type: 'finish_waba_only', wabaId } : null
    }
    case 'CANCEL':
      return { type: 'cancel', step: str(d.current_step) }
    case 'ERROR':
      return { type: 'error', message: str(d.error_message) }
    default:
      return null
  }
}
