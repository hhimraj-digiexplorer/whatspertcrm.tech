import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { REAL_EXPERT_PROVIDER, parseOptions } from '@/lib/integrations/real-expert/config'
import { realExpertRequest, RealExpertError } from '@/lib/integrations/real-expert/client'
import { targetFor } from '@/lib/integrations/real-expert/sync'

/** POST /api/integrations/real-expert/test — call the CRM with the saved key. */
export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`crm-test:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data, error } = await ctx.supabase
      .from('crm_integrations')
      .select('base_url, api_key, options')
      .eq('account_id', ctx.accountId)
      .eq('provider', REAL_EXPERT_PROVIDER)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Save your Real Expert details first.' }, { status: 404 })

    let target
    try {
      target = targetFor(data)
    } catch {
      return NextResponse.json({ ok: false, message: 'The saved API key could not be read. Please enter it again.' })
    }
    try {
      const me = (await realExpertRequest(target, 'GET', parseOptions(data.options).options.test_path)) as {
        workspace?: { name?: unknown }
      } | null
      // GET /v1/me names the workspace, so a key from the wrong client is obvious.
      const workspace = typeof me?.workspace?.name === 'string' ? me.workspace.name : null
      return NextResponse.json({ ok: true, workspace })
    } catch (err) {
      const message = err instanceof RealExpertError ? err.message : 'Could not reach Real Expert.'
      return NextResponse.json({ ok: false, message })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
