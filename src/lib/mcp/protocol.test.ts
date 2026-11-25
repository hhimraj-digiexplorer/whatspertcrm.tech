import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/whatsapp/send-message', () => ({
  SendMessageError: class SendMessageError extends Error {},
  sendMessageToConversation: vi.fn(),
  validateSendMessageParams: vi.fn(),
}))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ resolveConversationByPhone: vi.fn() }))

import { handleRpc, SUPPORTED_PROTOCOL_VERSIONS } from './protocol'
import { TOOLS } from './tools'

const ctx = (scopes: string[]) => ({ db: {} as never, accountId: 'a1', scopes })
const ALL = ['messages:send', 'messages:read', 'contacts:read', 'contacts:write', 'conversations:read']

describe('MCP protocol', () => {
  it('initializes with the client’s version when supported, else the latest', async () => {
    const r1 = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx(ALL))) as {
      result: { protocolVersion: string; serverInfo: { name: string }; capabilities: unknown }
    }
    expect(r1.result.protocolVersion).toBe('2025-03-26')
    expect(r1.result.serverInfo.name).toBe('whatspert')
    expect(r1.result.capabilities).toEqual({ tools: { listChanged: false } })
    const r2 = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx(ALL))) as {
      result: { protocolVersion: string }
    }
    expect(r2.result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0])
  })

  it('does not reply to notifications', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx(ALL))).toBeNull()
  })

  it('lists only the tools the key’s scopes allow', async () => {
    const all = (await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx(ALL))) as { result: { tools: { name: string }[] } }
    expect(all.result.tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort())
    const readOnly = (await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, ctx(['contacts:read']))) as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }
    }
    expect(readOnly.result.tools.map((t) => t.name).sort()).toEqual(['get_contact', 'search_contacts'])
    expect(readOnly.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true)
  })

  it('refuses a tool outside the key’s scopes', async () => {
    const r = (await handleRpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'send_message', arguments: { to: '+91', text: 'hi' } } },
      ctx(['contacts:read']),
    )) as { error: { code: number } }
    expect(r.error.code).toBe(-32602)
  })

  it('returns input problems as tool errors the model can read', async () => {
    const r = (await handleRpc(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_contact', arguments: { contact_id: 'not-an-id' } } },
      ctx(ALL),
    )) as { result: { isError: boolean; content: { text: string }[] } }
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toMatch(/contact_id/)
  })

  it('rejects malformed messages and unknown methods', async () => {
    expect(await handleRpc({ id: 7, method: 'tools/list' } as never, ctx(ALL))).toMatchObject({ error: { code: -32600 } })
    expect(await handleRpc({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, ctx(ALL))).toMatchObject({ error: { code: -32601 } })
  })

  it('every tool has a JSON-schema object input', () => {
    for (const t of TOOLS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
    }
  })
})
