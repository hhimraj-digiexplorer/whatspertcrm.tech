import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth/api-context'
import { ApiError } from '@/lib/api/v1/respond'
import { BillingBlockedError } from '@/lib/billing/server'
import { handleRpc, type JsonRpcRequest } from '@/lib/mcp/protocol'

/**
 * POST /api/mcp — Whatspert MCP server (Streamable HTTP, stateless).
 *
 * Connect Claude Code, Claude Desktop, Cursor or any MCP client with:
 *   URL     https://<your-domain>/api/mcp
 *   Header  Authorization: Bearer <Whatspert API key>
 * The key's scopes decide which tools appear (Settings → API keys).
 * Requires the plan's API feature, like the public API.
 */

export const dynamic = 'force-dynamic'

function rpcError(status: number, code: number, message: string, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers: extraHeaders })
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireApiKey(request)
  } catch (e) {
    if (e instanceof ApiError) {
      const status = e.status
      return rpcError(status, -32001, e.message, status === 401 ? { 'WWW-Authenticate': 'Bearer realm="whatspert"' } : {})
    }
    if (e instanceof BillingBlockedError) {
      return rpcError(402, -32002, "The API isn't available on this workspace's plan, or the account is inactive.")
    }
    throw e
  }

  const body = (await request.json().catch(() => undefined)) as JsonRpcRequest | JsonRpcRequest[] | undefined
  if (body === undefined) return rpcError(400, -32700, 'Parse error')

  const toolCtx = { db: ctx.supabase, accountId: ctx.accountId, scopes: ctx.scopes }
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return rpcError(400, -32600, 'Invalid Request')
    const replies = (await Promise.all(body.map((m) => handleRpc(m, toolCtx)))).filter((r) => r !== null)
    return replies.length ? NextResponse.json(replies) : new NextResponse(null, { status: 202 })
  }
  const reply = await handleRpc(body, toolCtx)
  return reply ? NextResponse.json(reply) : new NextResponse(null, { status: 202 })
}

// Stateless server: no server-initiated stream and no sessions to end.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}
