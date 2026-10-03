import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { drainCrmQueue } from '@/lib/integrations/real-expert/sync'

/**
 * POST /api/integrations/real-expert/sync — push the account's queued
 * CRM updates now. Called by "Sync now" and after deal edits, so any
 * agent may call it; it only ever touches the caller's account.
 */
export async function POST() {
  try {
    const ctx = await requireRole('agent')
    const limit = checkRateLimit(`crm-sync:${ctx.accountId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const result = await drainCrmQueue(supabaseAdmin(), { accountId: ctx.accountId, limit: 50 })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
