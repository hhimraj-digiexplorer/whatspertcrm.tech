/**
 * Multi-number workspaces (migration 052).
 *
 * The primary number lives in whatsapp_config together with the WABA id
 * and the token. Extra numbers live in whatsapp_numbers and belong to the
 * same WABA, so the token is shared. A conversation remembers the number
 * the customer last wrote to (conversations.phone_number_id) and every
 * reply — manual, AI, automation, flow — goes out from that number.
 *
 * Every lookup here fails safe: if anything is missing or errors, the
 * primary number is used, which is exactly the single-number behaviour.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Loose client type: callers pass both the user-scoped server client and
// the service-role admin client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface WorkspaceNumber {
  id: string
  phone_number_id: string
  display_phone_number: string | null
  verified_name: string | null
  label: string | null
  status: 'active' | 'disabled'
  created_at: string
}

/** Numbers this workspace may have in total, primary included. */
export async function workspaceNumberLimit(db: Db, accountId: string): Promise<number> {
  const { data } = await db
    .from('account_billing')
    .select('max_whatsapp_numbers_override, plan:plans(max_whatsapp_numbers)')
    .eq('account_id', accountId)
    .maybeSingle()
  const row = data as
    | { max_whatsapp_numbers_override?: number | null; plan?: { max_whatsapp_numbers?: number | null } | null }
    | null
  const override = row?.max_whatsapp_numbers_override
  if (typeof override === 'number' && override >= 1) return override
  const planLimit = row?.plan?.max_whatsapp_numbers
  return typeof planLimit === 'number' && planLimit >= 1 ? planLimit : 1
}

/** Extra numbers (not the primary), oldest first. */
export async function listExtraNumbers(db: Db, accountId: string): Promise<WorkspaceNumber[]> {
  const { data, error } = await db
    .from('whatsapp_numbers')
    .select('id, phone_number_id, display_phone_number, verified_name, label, status, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as WorkspaceNumber[]
}

/**
 * The phone_number_id a reply in this conversation should go out from.
 * Uses the conversation's number when it is an active extra number of
 * this workspace; otherwise the primary.
 */
export async function pickSendingNumber(
  db: Db,
  args: { accountId: string; primaryPhoneNumberId: string; conversationId?: string | null },
): Promise<string> {
  const { accountId, primaryPhoneNumberId, conversationId } = args
  if (!conversationId) return primaryPhoneNumberId
  try {
    const { data: conv } = await db
      .from('conversations')
      .select('phone_number_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    const wanted = (conv as { phone_number_id?: string | null } | null)?.phone_number_id
    if (!wanted || wanted === primaryPhoneNumberId) return primaryPhoneNumberId
    const { data: extra } = await db
      .from('whatsapp_numbers')
      .select('phone_number_id')
      .eq('account_id', accountId)
      .eq('phone_number_id', wanted)
      .eq('status', 'active')
      .maybeSingle()
    return extra ? wanted : primaryPhoneNumberId
  } catch {
    return primaryPhoneNumberId
  }
}

/**
 * The number a broadcast sends from: the chosen extra number if it is
 * still active in this workspace, else the primary.
 */
export async function resolveBroadcastNumber(
  db: Db,
  args: { accountId: string; primaryPhoneNumberId: string; requested?: string | null },
): Promise<string> {
  const { accountId, primaryPhoneNumberId, requested } = args
  if (!requested || requested === primaryPhoneNumberId) return primaryPhoneNumberId
  try {
    const { data } = await db
      .from('whatsapp_numbers')
      .select('phone_number_id')
      .eq('account_id', accountId)
      .eq('phone_number_id', requested)
      .eq('status', 'active')
      .maybeSingle()
    return data ? requested : primaryPhoneNumberId
  } catch {
    return primaryPhoneNumberId
  }
}

/**
 * The account an inbound phone_number_id belongs to, when it is an
 * extra number (the webhook checks whatsapp_config first).
 */
export async function accountForExtraNumber(db: Db, phoneNumberId: string): Promise<string | null> {
  const { data } = await db
    .from('whatsapp_numbers')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('status', 'active')
    .maybeSingle()
  return (data as { account_id?: string } | null)?.account_id ?? null
}

/**
 * Remember which number the customer wrote to, so replies go back from
 * it. Only writes when it changed.
 */
export async function rememberConversationNumber(
  db: Db,
  conversationId: string,
  phoneNumberId: string,
): Promise<void> {
  if (!/^\d+$/.test(phoneNumberId)) return
  const { error } = await db
    .from('conversations')
    .update({ phone_number_id: phoneNumberId })
    .eq('id', conversationId)
    .or(`phone_number_id.is.null,phone_number_id.neq.${phoneNumberId}`)
  if (error) console.warn('[workspace-numbers] could not record conversation number:', error.message)
}

/**
 * Keep extra numbers consistent with the primary connection: drop rows
 * from another WABA (the client connected a different account) and any
 * row for the number that is now the primary. Pass wabaId null when the
 * connection was removed — every extra number goes with it.
 */
export async function pruneExtraNumbers(
  db: Db,
  accountId: string,
  primary: { wabaId: string | null; phoneNumberId: string | null },
): Promise<void> {
  try {
    if (!primary.wabaId) {
      await db.from('whatsapp_numbers').delete().eq('account_id', accountId)
      return
    }
    await db.from('whatsapp_numbers').delete().eq('account_id', accountId).neq('waba_id', primary.wabaId)
    if (primary.phoneNumberId) {
      await db
        .from('whatsapp_numbers')
        .delete()
        .eq('account_id', accountId)
        .eq('phone_number_id', primary.phoneNumberId)
    }
  } catch (err) {
    console.warn('[workspace-numbers] prune failed:', err instanceof Error ? err.message : err)
  }
}
