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
