import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'

const GRAPH = 'https://graph.facebook.com/v21.0'
const FIELDS = [
  'id',
  'display_phone_number',
  'verified_name',
  'quality_rating',
  'messaging_limit_tier',
  'status',
  'name_status',
  'code_verification_status',
  'platform_type',
  'last_onboarded_time',
].join(',')

export interface WabaNumberHealth {
  id: string
  display_phone_number: string
  verified_name: string | null
  quality_rating: string | null
  messaging_limit_tier: string | null
  status: string | null
  name_status: string | null
  platform_type: string | null
  last_onboarded_time: string | null
}

/**
 * GET /api/whatsapp/numbers — the connected WhatsApp Business Account
 * and the health of each number in it (status, quality rating,
 * messaging limit), read live from Meta with the saved token.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data: cfg, error } = await ctx.supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, access_token, status, onboarding_method, registered_at, updated_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (error) throw error
    if (!cfg) return NextResponse.json({ connected: false })

    const base = {
      connected: true,
      status: cfg.status as string,
      waba_id: cfg.waba_id as string | null,
      phone_number_id: cfg.phone_number_id as string,
      onboarding_method: (cfg.onboarding_method as string | undefined) ?? 'manual',
      registered: cfg.registered_at != null,
      last_sync: new Date().toISOString(),
    }

    let token: string
    try {
      token = decrypt(cfg.access_token as string)
    } catch {
      return NextResponse.json({ ...base, error: 'token_corrupted', business_name: null, numbers: [] })
    }

    const get = async (path: string) => {
      const res = await fetch(`${GRAPH}/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error?.message || `Meta error ${res.status}`)
      return body
    }

    try {
      if (!cfg.waba_id) {
        const one = await get(`${cfg.phone_number_id}?fields=${FIELDS}`)
        return NextResponse.json({ ...base, business_name: null, numbers: [one] })
      }
      const [waba, list] = await Promise.all([
        get(`${cfg.waba_id}?fields=name`),
        get(`${cfg.waba_id}/phone_numbers?fields=${FIELDS}&limit=100`),
      ])
      return NextResponse.json({
        ...base,
        business_name: (waba?.name as string) ?? null,
        numbers: (list?.data ?? []) as WabaNumberHealth[],
      })
    } catch (err) {
      return NextResponse.json({
        ...base,
        error: err instanceof Error ? err.message : 'meta_error',
        business_name: null,
        numbers: [],
      })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
