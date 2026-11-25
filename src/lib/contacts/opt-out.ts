/**
 * Built-in WhatsApp opt-out (migration 053).
 *
 * The webhook checks every inbound text with `optOutIntent` BEFORE the
 * flow runner, so STOP works even in the middle of a bot menu. Every
 * automatic sender then calls `assertCanAutoMessage` (automations,
 * flows, AI) or filters with `optedOutContactIds` (broadcasts).
 *
 * The one exception: within OPT_OUT_GRACE_MS of the opt-out, automatic
 * sends still go out, so a workspace's own STOP automation can send its
 * "You're unsubscribed" confirmation. Anything later (follow-ups after a
 * wait, the next broadcast) is blocked.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const OPT_OUT_TAG = 'Opted out'
export const OPT_OUT_GRACE_MS = 90_000

const OPT_OUT_WORDS = new Set([
  'stop',
  'stop all',
  'stopall',
  'unsubscribe',
  'opt out',
  'optout',
  'opt-out',
  'remove me',
  'dont message',
  'do not message',
  'band karo',
  'बंद करो',
  'बंद',
])
const OPT_IN_WORDS = new Set(['start', 'unstop', 'subscribe', 'resubscribe', 'opt in', 'optin', 'opt-in'])

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`"]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is this whole message an opt-out or opt-in request? Only exact short
 * messages count ("STOP", "Stop!", "unsubscribe") — "stop calling me
 * after 6pm" or "don't stop" are ordinary messages.
 */
export function optOutIntent(text: string | null | undefined): 'opt_out' | 'opt_in' | null {
  if (!text) return null
  const t = normalise(text)
  if (!t || t.length > 30) return null
  if (OPT_OUT_WORDS.has(t)) return 'opt_out'
  if (OPT_IN_WORDS.has(t)) return 'opt_in'
  return null
}

export class ContactOptedOutError extends Error {
  readonly code = 'contact_opted_out'
  constructor() {
    super('The contact opted out (sent STOP); automatic messages are not sent to them.')
    this.name = 'ContactOptedOutError'
  }
}

/** Opted out long enough ago that automatic sends must stop. */
export function blocksAutoMessages(optedOutAt: string | null | undefined, now = Date.now()): boolean {
  if (!optedOutAt) return false
  const at = Date.parse(optedOutAt)
  if (Number.isNaN(at)) return true
  return now - at > OPT_OUT_GRACE_MS
}

/** Throws ContactOptedOutError when automatic messages to this contact are blocked. */
export async function assertCanAutoMessage(db: Db, accountId: string, contactId: string): Promise<void> {
  const { data } = await db
    .from('contacts')
    .select('opted_out_at')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (blocksAutoMessages((data as { opted_out_at?: string | null } | null)?.opted_out_at)) {
    throw new ContactOptedOutError()
  }
}

/** The subset of these contacts that opted out (any time — broadcasts get no grace). */
export async function optedOutContactIds(db: Db, accountId: string, contactIds: string[]): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set()
  const out = new Set<string>()
  for (let i = 0; i < contactIds.length; i += 500) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .in('id', contactIds.slice(i, i + 500))
      .not('opted_out_at', 'is', null)
    for (const r of data ?? []) out.add((r as { id: string }).id)
  }
  return out
}

/**
 * Mark a contact opted out / back in. Returns true when it changed.
 * Only the first opt-out sets the time, so a repeated STOP doesn't
 * reopen the confirmation window.
 */
export async function setContactOptOut(
  db: Db,
  args: { accountId: string; contactId: string; optedOut: boolean; source: 'keyword' | 'agent' | 'api' },
): Promise<boolean> {
  const { accountId, contactId, optedOut, source } = args
  const q = db
    .from('contacts')
    .update(
      optedOut
        ? { opted_out_at: new Date().toISOString(), opt_out_source: source }
        : { opted_out_at: null, opt_out_source: null },
    )
    .eq('id', contactId)
    .eq('account_id', accountId)
  const { data, error } = await (optedOut ? q.is('opted_out_at', null) : q.not('opted_out_at', 'is', null)).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
