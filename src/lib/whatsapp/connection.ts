import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './encryption'

/** The account's saved WhatsApp connection, with the token decrypted. */
export interface AccountConnection {
  phoneNumberId: string
  wabaId: string | null
  accessToken: string
  onboardingMethod: string
  twoStepPin: string | null
}

export class ConnectionError extends Error {
  constructor(
    public readonly code: 'not_connected' | 'no_waba' | 'token_corrupted',
    message: string,
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

const MESSAGES: Record<ConnectionError['code'], string> = {
  not_connected: 'Connect a WhatsApp number first.',
  no_waba: 'This connection has no WhatsApp Business Account ID. Add it under “Connect with API credentials”.',
  token_corrupted: "The saved access token can't be read. Reconnect your number.",
}

/**
 * Loads and decrypts the account's connection. Pass `requireWaba` for
 * actions on the WhatsApp Business Account itself (adding numbers,
 * setup checks, webhook repair).
 */
export async function loadAccountConnection(
  supabase: SupabaseClient,
  accountId: string,
  opts: { requireWaba?: boolean } = {},
): Promise<AccountConnection> {
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, waba_id, access_token, onboarding_method, two_step_pin')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ConnectionError('not_connected', MESSAGES.not_connected)
  if (opts.requireWaba && !data.waba_id) throw new ConnectionError('no_waba', MESSAGES.no_waba)
  let accessToken: string
  let twoStepPin: string | null = null
  try {
    accessToken = decrypt(data.access_token as string)
  } catch {
    throw new ConnectionError('token_corrupted', MESSAGES.token_corrupted)
  }
  if (data.two_step_pin) {
    try {
      twoStepPin = decrypt(data.two_step_pin as string)
    } catch {
      twoStepPin = null
    }
  }
  return {
    phoneNumberId: data.phone_number_id as string,
    wabaId: (data.waba_id as string | null) ?? null,
    accessToken,
    onboardingMethod: (data.onboarding_method as string | null) ?? 'manual',
    twoStepPin,
  }
}

/** Response for a ConnectionError, or null to let the caller rethrow. */
export function connectionErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof ConnectionError)) return null
  return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
}
