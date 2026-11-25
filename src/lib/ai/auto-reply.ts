import { assertCanAutoMessage, ContactOptedOutError } from '@/lib/contacts/opt-out'
import { supabaseAdmin } from './admin-client'
import { dispatchConversationAssigned } from '@/lib/automations/assignment'
import { loadAiConfig } from './config'
import { platformAiQuota } from './platform'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { assertFeature, BillingBlockedError } from '@/lib/billing/server'
import { triggerMatches } from '@/lib/automations/engine'
import { loadProjectScope } from './project-scope'
import type { Automation } from '@/types'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
  /** Text of the inbound message, to see whether a message automation
   *  that sends its own reply matched it (then the AI stands down). */
  inboundText?: string
  /** The inbound is the contact's first-ever message. */
  firstInbound?: boolean
}

const SEND_STEPS = new Set(['send_message', 'send_template', 'send_buttons', 'send_list'])

/**
 * True when an active New Message / Keyword automation matches this
 * inbound AND sends the customer something — the AI then stays quiet so
 * the customer doesn't get two replies. Automations that only tag, score
 * or move the lead (a "replied" marker) don't count.
 */
export async function replyingAutomationMatches(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  ctx: { message_text: string; first_inbound?: boolean },
): Promise<boolean> {
  const { data: autos } = await db
    .from('automations')
    .select('id, account_id, user_id, name, trigger_type, trigger_config, is_active')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .in('trigger_type', ['new_message_received', 'keyword_match'])
  const matched = ((autos ?? []) as unknown as Automation[]).filter((a) => triggerMatches(a, ctx))
  if (matched.length === 0) return false
  const { data: steps } = await db
    .from('automation_steps')
    .select('automation_id, step_type')
    .in('automation_id', matched.map((a) => a.id))
  return (steps ?? []).some((s) => SEND_STEPS.has(s.step_type as string))
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return
    // STOP (migration 053): the AI never writes to an opted-out contact.
    try {
      await assertCanAutoMessage(db, accountId, contactId)
    } catch (err) {
      if (err instanceof ContactOptedOutError) return
      throw err
    }

    // Whatspert key: monthly allowance of AI chatbot conversations.
    if (config.onPlatformKey) {
      const quota = await platformAiQuota(accountId, conversationId)
      if (!quota.allowed) {
        console.warn(
          `[ai auto-reply] account ${accountId} used its ${quota.limit} AI conversations this month on the Whatspert key — skipping.`,
        )
        return
      }
    }

    // Plan must include AI, and the account must be in good standing.
    try {
      await assertFeature(accountId, 'ai')
    } catch (err) {
      if (err instanceof BillingBlockedError) return
      throw err
    }

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    // Only stand down when such an automation actually matched THIS
    // message and replies itself — not merely because one exists (that
    // silenced the AI for any workspace with, say, a STOP keyword).
    if (
      args.inboundText &&
      (await replyingAutomationMatches(db, accountId, {
        message_text: args.inboundText,
        first_inbound: args.firstInbound,
      }))
    ) {
      return
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId, conversationId)
    }

    // Per-project mode (channel partners): the contact's project tags
    // decide what the agent may talk about, and — when the account asks
    // for it — a contact with no project or several is handed to a person
    // before any reply is generated.
    const scope = config.projectScope ? await loadProjectScope(db, accountId, contactId) : null
    if (scope && config.projectHandoff && scope.tagNames.length !== 1) {
      await handOffConversation(db, {
        accountId,
        conversationId,
        conv,
        handoffAgentId: config.handoffAgentId,
        summary: buildHandoffSummary({ messages, replyCount: conv.ai_reply_count ?? 0 }),
      })
      return
    }

    // Ground the reply in the account's knowledge base (best-effort);
    // with project scope, only shared documents and the contact's own
    // project's documents.
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
      5,
      scope ? { projects: scope.tagNames } : {},
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      ...(scope ? { projectScope: { projects: scope.displayNames } } : {}),
    })

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      await handOffConversation(db, {
        accountId,
        conversationId,
        conv,
        handoffAgentId: config.handoffAgentId,
        summary: buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
        }),
      })
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
  conversationId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
      conversationId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}

/**
 * Stop auto-replying on this thread and hand it to a human: (a) pause
 * the bot here (sticky until re-enabled), (b) route the conversation to
 * the configured handoff agent — null leaves it in the shared queue — and
 * (c) leave a short summary so whoever picks it up has context.
 * Assigning fires the `on_conversation_assigned` trigger, which notifies
 * the agent.
 */
async function handOffConversation(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    accountId: string
    conversationId: string
    conv: { assigned_agent_id: string | null }
    handoffAgentId: string | null
    summary: string
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: args.summary,
  }
  // Only set the assignee when a target is configured AND the thread
  // isn't already owned — never stomp an existing human assignment.
  if (args.handoffAgentId && !args.conv.assigned_agent_id) {
    update.assigned_agent_id = args.handoffAgentId
  }
  await db.from('conversations').update(update).eq('id', args.conversationId)
  if (update.assigned_agent_id) {
    await dispatchConversationAssigned({
      accountId: args.accountId,
      conversationId: args.conversationId,
      agentId: update.assigned_agent_id as string,
    })
  }
}
