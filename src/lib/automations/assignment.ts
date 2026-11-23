import type { SupabaseClient } from '@supabase/supabase-js'

import { runAutomationsForTrigger, type AutomationContext } from './engine'
import { supabaseAdmin } from './admin-client'
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from '@/lib/contacts/tag-chain'

/**
 * Fire `conversation_assigned` for a conversation that was just given to
 * an agent. Nothing ever dispatched this trigger before, so automations
 * built on it never ran.
 *
 * Call it after the assignment is saved, only when the assignee actually
 * changed to a person (not on un-assign). Never throws.
 *
 * Automations can themselves assign (assign_conversation step), so the
 * same chain-depth counter that stops tag_added loops caps this too.
 */
export async function dispatchConversationAssigned(input: {
  accountId: string
  conversationId: string
  agentId: string
  context?: AutomationContext
  db?: SupabaseClient
}): Promise<void> {
  try {
    const depth = getTagChainDepth(input.context)
    if (depth >= MAX_TAG_CHAIN_DEPTH) {
      console.warn('[automations] conversation_assigned chain depth limit reached', {
        conversationId: input.conversationId,
        depth,
      })
      return
    }
    const db = input.db ?? supabaseAdmin()
    const { data: conv } = await db
      .from('conversations')
      .select('contact_id')
      .eq('id', input.conversationId)
      .eq('account_id', input.accountId)
      .maybeSingle()
    if (!conv?.contact_id) return
    await runAutomationsForTrigger({
      accountId: input.accountId,
      triggerType: 'conversation_assigned',
      contactId: conv.contact_id as string,
      context: {
        ...input.context,
        conversation_id: input.conversationId,
        agent_id: input.agentId,
        vars: {
          ...(input.context?.vars ?? {}),
          _tag_chain_depth: depth + 1,
        },
      },
    })
  } catch (err) {
    console.error('[automations] conversation_assigned dispatch failed:', err)
  }
}
