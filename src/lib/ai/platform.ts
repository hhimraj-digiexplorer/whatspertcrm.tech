import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { AiProvider } from './types'

/**
 * Whatspert's own AI key, for workspaces the platform admin has put on
 * "Whatspert key" (account_billing.ai_key_source = 'platform'). Set in
 * the server config: PLATFORM_AI_PROVIDER (openai | anthropic),
 * PLATFORM_AI_MODEL, PLATFORM_AI_API_KEY and, optionally,
 * PLATFORM_AI_EMBEDDINGS_KEY (OpenAI, for semantic knowledge search).
 */
export interface PlatformAi {
  provider: AiProvider
  model: string
  apiKey: string
  embeddingsApiKey: string | null
  /** Sent as anthropic-workspace-id for user-linked (unscoped) keys. */
  anthropicWorkspaceId: string | null
}

const DEFAULT_MODEL: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5-5',
}

/** The platform key, or null when the server has none configured. */
export function platformAi(env: NodeJS.ProcessEnv = process.env): PlatformAi | null {
  const apiKey = env.PLATFORM_AI_API_KEY?.trim()
  if (!apiKey) return null
  const provider: AiProvider = env.PLATFORM_AI_PROVIDER?.trim() === 'anthropic' ? 'anthropic' : 'openai'
  return {
    provider,
    model: env.PLATFORM_AI_MODEL?.trim() || DEFAULT_MODEL[provider],
    apiKey,
    embeddingsApiKey: env.PLATFORM_AI_EMBEDDINGS_KEY?.trim() || null,
    anthropicWorkspaceId: env.PLATFORM_AI_ANTHROPIC_WORKSPACE_ID?.trim() || null,
  }
}

export type AiKeySource = 'client' | 'platform'

/** Whose key a workspace's AI uses (service role; defaults to 'client'). */
export async function aiKeySource(accountId: string): Promise<AiKeySource> {
  const { data, error } = await supabaseAdmin()
    .from('account_billing')
    .select('ai_key_source')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[ai] key source lookup failed:', error.message)
    return 'client'
  }
  return data?.ai_key_source === 'platform' ? 'platform' : 'client'
}

/**
 * AI chatbot conversations used this calendar month (UTC) on the
 * Whatspert key: distinct conversations the AI replied in or drafted
 * for (ai_usage_log). The allowance is
 * account_billing.ai_platform_conversation_limit (default 2,500).
 * A conversation already counted this month may always continue.
 */
export async function platformAiQuota(
  accountId: string,
  conversationId: string | null,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const db = supabaseAdmin()
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const [{ data: billing }, { data: rows, error }] = await Promise.all([
    db.from('account_billing').select('ai_platform_conversation_limit').eq('account_id', accountId).maybeSingle(),
    db
      .from('ai_usage_log')
      .select('conversation_id')
      .eq('account_id', accountId)
      .gte('created_at', since)
      .not('conversation_id', 'is', null)
      .limit(100000),
  ])
  const limit = Number(billing?.ai_platform_conversation_limit ?? 2500)
  if (error) {
    // Don't take the bot down over a metering read failure.
    console.error('[ai] platform quota read failed:', error.message)
    return { allowed: true, used: 0, limit }
  }
  const seen = new Set((rows ?? []).map((r) => r.conversation_id as string))
  const used = seen.size
  const allowed = (conversationId !== null && seen.has(conversationId)) || used < limit
  return { allowed, used, limit }
}
