/**
 * Whatspert MCP tools — what a client's Claude / ChatGPT can do with
 * their own workspace over /api/mcp.
 *
 * Every tool declares the API-key scope it needs (the same scopes as the
 * public API), runs on the service-role client and is always filtered by
 * the key's account_id.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { hasScope, type ApiScope } from '@/lib/api-keys/scopes'
import {
  CONTACT_SELECT,
  getContactById,
  resolveAuditUserId,
  serializeContact,
  setContactTags,
} from '@/lib/api/v1/contacts'
import { serializeConversation, serializeMessage } from '@/lib/api/v1/conversations'
import { CONVERSATION_SELECT, normalizeConversations } from '@/lib/inbox/conversations'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation, validateSendMessageParams } from '@/lib/whatsapp/send-message'
import type { Conversation, Message } from '@/types'

export interface McpToolContext {
  db: SupabaseClient
  accountId: string
  scopes: string[]
}

type JsonSchema = Record<string, unknown>

export interface McpTool {
  name: string
  title: string
  description: string
  scope: ApiScope
  /** true = reads only (clients may run it without asking). */
  readOnly: boolean
  inputSchema: JsonSchema
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>
}

export class ToolInputError extends Error {}

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const int = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
}
const strList = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 60)).slice(0, max) : []
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ToolInputError(`'${field}' must be an id from an earlier result`)
  return v
}

async function countRows(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await q
  return count ?? 0
}

export const TOOLS: McpTool[] = [
  {
    name: 'get_overview',
    title: 'Workspace overview',
    description:
      'Snapshot of the WhatsApp sales workspace: open and unread conversations, contacts (total and new in the last 7 days), messages received today. Start here.',
    scope: 'conversations:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run({ db, accountId }) {
      const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const head = { count: 'exact' as const, head: true }
      const [open, unread, contacts, newContacts, inboundToday] = await Promise.all([
        countRows(db.from('conversations').select('id', head).eq('account_id', accountId).eq('status', 'open')),
        countRows(db.from('conversations').select('id', head).eq('account_id', accountId).gt('unread_count', 0)),
        countRows(db.from('contacts').select('id', head).eq('account_id', accountId)),
        countRows(db.from('contacts').select('id', head).eq('account_id', accountId).gte('created_at', since7)),
        countRows(
          db
            .from('messages')
            .select('id, conversations!inner(account_id)', head)
            .eq('conversations.account_id', accountId)
            .eq('sender_type', 'customer')
            .gte('created_at', today.toISOString()),
        ),
      ])
      return {
        open_conversations: open,
        unread_conversations: unread,
        contacts_total: contacts,
        contacts_new_last_7_days: newContacts,
        customer_messages_today: inboundToday,
      }
    },
  },
  {
    name: 'search_contacts',
    title: 'Search contacts / leads',
    description:
      'Find contacts by name, phone or email, optionally only those with a tag (e.g. "Hot lead"). Returns id, phone, name, email, company and tags.',
    scope: 'contacts:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of a name, phone number or email.' },
        tag: { type: 'string', description: 'Only contacts with this tag (exact name, case-insensitive).' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      const limit = int(args.limit, 20, 1, 50)
      const query = str(args.query, 80)
      const tag = str(args.tag, 60)
      let q = db.from('contacts').select(CONTACT_SELECT).eq('account_id', accountId)
      if (tag) {
        const { data: tagRow } = await db
          .from('tags')
          .select('id')
          .eq('account_id', accountId)
          .ilike('name', tag.replace(/[%_]/g, '\\$&'))
          .maybeSingle()
        if (!tagRow) return { contacts: [], note: `No tag named "${tag}".` }
        const { data: links } = await db.from('contact_tags').select('contact_id').eq('tag_id', (tagRow as { id: string }).id).limit(1000)
        const ids = (links ?? []).map((l) => (l as { contact_id: string }).contact_id)
        if (ids.length === 0) return { contacts: [] }
        q = q.in('id', ids)
      }
      if (query) {
        const safe = query.replace(/[%_,()]/g, ' ').trim()
        if (safe) q = q.or(`name.ilike.%${safe}%,phone.ilike.%${safe.replace(/\D/g, '') || safe}%,email.ilike.%${safe}%`)
      }
      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return { contacts: (data ?? []).map((r) => serializeContact(r as Record<string, unknown>)) }
    },
  },
  {
    name: 'get_contact',
    title: 'Contact details',
    description: 'One contact with their tags and open deals (pipeline and stage).',
    scope: 'contacts:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { contact_id: { type: 'string', description: 'Contact id from search_contacts.' } },
      required: ['contact_id'],
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      const id = uuid(args.contact_id, 'contact_id')
      const contact = await getContactById(db, accountId, id)
      if (!contact) throw new ToolInputError('Contact not found')
      const { data: deals } = await db
        .from('deals')
        .select('id, title, value, currency, status, updated_at, pipeline:pipelines(name), stage:pipeline_stages(name)')
        .eq('account_id', accountId)
        .eq('contact_id', id)
        .order('updated_at', { ascending: false })
        .limit(10)
      return { contact, deals: deals ?? [] }
    },
  },
  {
    name: 'list_conversations',
    title: 'List conversations',
    description: 'Most recent WhatsApp conversations with the contact and last message. Filter by status or unread only.',
    scope: 'conversations:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'pending', 'closed'] },
        unread_only: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      let q = db.from('conversations').select(CONVERSATION_SELECT).eq('account_id', accountId)
      const status = str(args.status, 10)
      if (status && ['open', 'pending', 'closed'].includes(status)) q = q.eq('status', status)
      if (args.unread_only === true) q = q.gt('unread_count', 0)
      const { data, error } = await q
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(int(args.limit, 20, 1, 50))
      if (error) throw error
      return { conversations: normalizeConversations((data ?? []) as never).map((c: Conversation) => serializeConversation(c)) }
    },
  },
  {
    name: 'get_messages',
    title: 'Read a conversation',
    description: 'Messages of one conversation, oldest first (up to the last 50).',
    scope: 'messages:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'Conversation id from list_conversations.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
      },
      required: ['conversation_id'],
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      const id = uuid(args.conversation_id, 'conversation_id')
      const { data: conv } = await db.from('conversations').select('id').eq('id', id).eq('account_id', accountId).maybeSingle()
      if (!conv) throw new ToolInputError('Conversation not found')
      const { data, error } = await db
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(int(args.limit, 30, 1, 50))
      if (error) throw error
      return { messages: ((data ?? []) as Message[]).reverse().map(serializeMessage) }
    },
  },
  {
    name: 'list_templates',
    title: 'List approved templates',
    description:
      'Approved WhatsApp message templates (name, language, category, body). Use one to message a customer outside the 24-hour reply window.',
    scope: 'messages:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run({ db, accountId }) {
      const { data, error } = await db
        .from('message_templates')
        .select('name, language, category, status, body_text')
        .eq('account_id', accountId)
        .order('name')
        .limit(200)
      if (error) throw error
      const approved = (data ?? []).filter((t) => String((t as { status?: string }).status ?? '').toUpperCase() === 'APPROVED')
      return { templates: approved }
    },
  },
  {
    name: 'send_message',
    title: 'Send a WhatsApp message',
    description:
      'Send a WhatsApp message to a customer: free text (only within 24 hours of their last message) or an approved template with body parameters. Give a phone number (with country code) or a conversation id. Always confirm the recipient and text with the user before calling.',
    scope: 'messages:send',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Phone number with country code, e.g. +919876543210.' },
        conversation_id: { type: 'string', description: 'Or an existing conversation id.' },
        text: { type: 'string', description: 'Free-text message (24-hour window only).' },
        template_name: { type: 'string', description: 'Approved template name (from list_templates).' },
        template_language: { type: 'string', description: 'Template language, e.g. en or en_US.' },
        template_params: { type: 'array', items: { type: 'string' }, description: 'Body parameters {{1}}, {{2}}… in order.' },
      },
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      const text = str(args.text, 4096)
      const templateName = str(args.template_name, 512)
      if (!text && !templateName) throw new ToolInputError("Give 'text' or 'template_name'")
      const messageType = templateName ? 'template' : 'text'
      validateSendMessageParams({ messageType, contentText: text, mediaUrl: null, templateName, interactivePayload: null })
      let conversationId: string
      if (args.conversation_id !== undefined) {
        conversationId = uuid(args.conversation_id, 'conversation_id')
        const { data: conv } = await db.from('conversations').select('id').eq('id', conversationId).eq('account_id', accountId).maybeSingle()
        if (!conv) throw new ToolInputError('Conversation not found')
      } else {
        const to = str(args.to, 32)
        if (!to) throw new ToolInputError("Give 'to' (phone number) or 'conversation_id'")
        conversationId = (await resolveConversationByPhone(db, accountId, to, null)).conversationId
      }
      const result = await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType,
        contentText: text,
        mediaUrl: null,
        filename: null,
        templateName,
        templateLanguage: str(args.template_language, 20),
        templateParams: strList(args.template_params, 20),
        templateMessageParams: undefined,
        interactivePayload: null,
        replyToMessageId: null,
      })
      return { sent: true, conversation_id: conversationId, message_id: result.messageId }
    },
  },
  {
    name: 'update_contact_tags',
    title: 'Tag or untag a contact',
    description: 'Add and/or remove tags on a contact (e.g. add "Hot lead", remove "Cold"). Missing tags are created.',
    scope: 'contacts:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        add: { type: 'array', items: { type: 'string' } },
        remove: { type: 'array', items: { type: 'string' } },
      },
      required: ['contact_id'],
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      const id = uuid(args.contact_id, 'contact_id')
      const contact = await getContactById(db, accountId, id)
      if (!contact) throw new ToolInputError('Contact not found')
      const remove = new Set(strList(args.remove).map((t) => t.toLowerCase()))
      const names = new Map<string, string>()
      for (const t of contact.tags) if (!remove.has(t.name.toLowerCase())) names.set(t.name.toLowerCase(), t.name)
      for (const t of strList(args.add)) names.set(t.toLowerCase(), t)
      await setContactTags(db, accountId, await resolveAuditUserId(db, accountId), id, [...names.values()])
      return { contact: await getContactById(db, accountId, id) }
    },
  },
  {
    name: 'list_pipelines',
    title: 'List sales pipelines',
    description: 'Sales pipelines and their stages, in order.',
    scope: 'conversations:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run({ db, accountId }) {
      const { data, error } = await db
        .from('pipelines')
        .select('id, name, stages:pipeline_stages(id, name, position)')
        .eq('account_id', accountId)
        .order('created_at')
      if (error) throw error
      return {
        pipelines: (data ?? []).map((p) => {
          const row = p as { id: string; name: string; stages?: { id: string; name: string; position: number }[] }
          return { id: row.id, name: row.name, stages: (row.stages ?? []).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name })) }
        }),
      }
    },
  },
  {
    name: 'move_deal',
    title: 'Move a deal to a stage',
    description: "Move a contact's latest open deal to another pipeline stage (by stage name, e.g. \"Site visit\").",
    scope: 'contacts:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        stage: { type: 'string', description: 'Stage name (from list_pipelines).' },
      },
      required: ['contact_id', 'stage'],
      additionalProperties: false,
    },
    async run({ db, accountId }, args) {
      const contactId = uuid(args.contact_id, 'contact_id')
      const stageName = str(args.stage, 80)
      if (!stageName) throw new ToolInputError("Give the 'stage' name")
      const { data: deal } = await db
        .from('deals')
        .select('id, pipeline_id, stage_id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .not('status', 'in', '(won,lost)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!deal) throw new ToolInputError('This contact has no open deal')
      const d = deal as { id: string; pipeline_id: string; stage_id: string }
      const { data: stages } = await db.from('pipeline_stages').select('id, name').eq('pipeline_id', d.pipeline_id)
      const stage = (stages ?? []).find((s) => (s as { name: string }).name.toLowerCase() === stageName.toLowerCase()) as
        | { id: string; name: string }
        | undefined
      if (!stage) {
        throw new ToolInputError(
          `No stage "${stageName}" in this deal's pipeline. Stages: ${(stages ?? []).map((s) => (s as { name: string }).name).join(', ')}`,
        )
      }
      if (stage.id === d.stage_id) return { moved: false, note: `Already in ${stage.name}` }
      const { error } = await db
        .from('deals')
        .update({ stage_id: stage.id, updated_at: new Date().toISOString() })
        .eq('id', d.id)
        .eq('account_id', accountId)
      if (error) throw error
      return { moved: true, deal_id: d.id, stage: stage.name }
    },
  },
]

/** The tools this key may use (others are hidden from tools/list). */
export function toolsForScopes(scopes: string[]): McpTool[] {
  return TOOLS.filter((t) => hasScope(scopes, t.scope))
}
