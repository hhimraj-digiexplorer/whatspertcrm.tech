import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { dispatchConversationAssigned } from '@/lib/automations/assignment'

type Params = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/conversations/[id]/assign  (agent+)
 * Body: { agent_id: string | null }
 *
 * Assign (or un-assign) a conversation from the inbox, then fire the
 * Conversation Assigned automations. The write goes through the
 * caller's session, so RLS still decides who may assign.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ctx = await requireRole('agent')
    const limit = checkRateLimit(`assign:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { agent_id?: unknown } | null
    const agentId = body?.agent_id
    if (agentId !== null && (typeof agentId !== 'string' || !UUID_RE.test(agentId))) {
      return NextResponse.json({ error: 'agent_id must be a user id or null.' }, { status: 400 })
    }

    const { data: conv, error: loadErr } = await ctx.supabase
      .from('conversations')
      .select('id, assigned_agent_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    if (agentId) {
      // Only members of this account can own its conversations.
      const { data: member } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', agentId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (!member) return NextResponse.json({ error: 'That user is not on this team.' }, { status: 400 })
    }

    const { error: upErr } = await ctx.supabase
      .from('conversations')
      .update({ assigned_agent_id: agentId })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (upErr) throw upErr

    if (agentId && conv.assigned_agent_id !== agentId) {
      await dispatchConversationAssigned({ accountId: ctx.accountId, conversationId: id, agentId })
    }
    return NextResponse.json({ success: true, assigned_agent_id: agentId })
  } catch (err) {
    return toErrorResponse(err)
  }
}
