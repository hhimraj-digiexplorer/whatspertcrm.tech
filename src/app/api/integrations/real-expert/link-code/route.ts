import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { generateLinkCode } from '@/lib/integrations/real-expert/settings'

const TTL_MINUTES = 30

/**
 * POST /api/integrations/real-expert/link-code — owner/admin only.
 * A one-time code to enter in Real Expert CRM, linking this existing
 * Whatspert account to the client's Real Expert workspace.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`crm-link-code:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const code = generateLinkCode()
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString()
    const db = supabaseAdmin()
    // One live code per account.
    await db.from('partner_link_codes').delete().eq('account_id', ctx.accountId).is('used_at', null)
    const { error } = await db.from('partner_link_codes').insert({
      code_hash: createHash('sha256').update(code.toUpperCase()).digest('hex'),
      account_id: ctx.accountId,
      created_by: ctx.userId,
      expires_at: expiresAt,
    })
    if (error) throw error
    return NextResponse.json({ code, expires_at: expiresAt })
  } catch (err) {
    return toErrorResponse(err)
  }
}
