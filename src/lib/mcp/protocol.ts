/**
 * Minimal MCP server (Streamable HTTP, stateless, JSON responses).
 * Pure JSON-RPC dispatch — the route handles auth and HTTP.
 *
 * Supported: initialize, notifications/*, ping, tools/list, tools/call.
 */

import { SendMessageError } from '@/lib/whatsapp/send-message'
import { ToolInputError, toolsForScopes, type McpToolContext } from './tools'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const SERVER_INFO = { name: 'whatspert', title: 'Whatspert CRM', version: '1.0.0' }

const INSTRUCTIONS =
  'Whatspert CRM: the WhatsApp sales workspace of this business. Use get_overview first. ' +
  'Contacts are leads; conversations are WhatsApp chats; deals sit in pipeline stages. ' +
  'Before send_message, confirm the recipient and the exact text with the user. ' +
  'Free text only reaches a customer within 24 hours of their last message; otherwise use an approved template (list_templates).'

export interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

const ok = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result })
const err = (id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})

function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Handle one JSON-RPC message. Returns null for notifications (no reply).
 */
export async function handleRpc(msg: JsonRpcRequest, ctx: McpToolContext): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return err(msg?.id, -32600, 'Invalid Request')
  }
  const isNotification = msg.id === undefined
  if (isNotification) return null

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : ''
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : SUPPORTED_PROTOCOL_VERSIONS[0]
      return ok(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, {
        tools: toolsForScopes(ctx.scopes).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: !t.readOnly },
        })),
      })
    case 'tools/call': {
      const name = msg.params?.name
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      const tool = toolsForScopes(ctx.scopes).find((t) => t.name === name)
      if (!tool) {
        return err(msg.id, -32602, `Unknown tool or missing API-key scope: ${String(name)}`)
      }
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return ok(msg.id, toolError('Arguments must be an object.'))
      }
      try {
        const data = await tool.run(ctx, args)
        return ok(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        })
      } catch (e) {
        if (e instanceof ToolInputError || e instanceof SendMessageError) return ok(msg.id, toolError(e.message))
        console.error(`[mcp] ${tool.name} failed:`, e)
        return ok(msg.id, toolError('Something went wrong on the Whatspert side. Please try again.'))
      }
    }
    default:
      return err(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}
