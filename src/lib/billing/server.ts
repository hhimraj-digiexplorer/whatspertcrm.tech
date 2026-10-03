// ============================================================
// Billing guards for API routes and the automation engine.
//
// Every outbound path (inbox send, broadcasts, public API, automation
// / flow / AI bot sends) calls `assertAccountActive` before it reaches
// Meta, so a suspended or lapsed account can't message customers.
// Reads go through the service-role client: `account_billing` and the
// usage function are not reachable with the caller's own session.
// ============================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  accessBlock,
  planFeatures,
  type AccessBlock,
  type AccountBilling,
  type Plan,
} from './plans';

export class BillingBlockedError extends Error {
  readonly status = 402 as const;
  constructor(
    readonly code: Exclude<AccessBlock, null> | 'plan_limit' | 'feature_not_in_plan',
    message: string,
  ) {
    super(message);
    this.name = 'BillingBlockedError';
  }
}

const BLOCK_MESSAGES: Record<Exclude<AccessBlock, null>, string> = {
  suspended: 'This account has been suspended. Contact support to restore access.',
  trial_ended: 'Your free trial has ended. Choose a plan in Settings → Billing to keep sending.',
  expired: 'Your subscription has ended. Renew in Settings → Billing to keep sending.',
};

export interface BillingSnapshot {
  billing: AccountBilling | null;
  plan: Plan | null;
}

function normalizePlan(row: Record<string, unknown> | null): Plan | null {
  if (!row) return null;
  return { ...(row as unknown as Plan), features: planFeatures(row.features) };
}

/** Billing row + its plan, via the service role. */
export async function loadBilling(accountId: string): Promise<BillingSnapshot> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('account_billing')
    .select('*, plan:plans(*)')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    // Don't lock accounts out because of a read failure — log and allow.
    console.error('[billing] loadBilling failed:', error.message);
    return { billing: null, plan: null };
  }
  if (!data) return { billing: null, plan: null };
  const { plan, ...billing } = data as AccountBilling & { plan: Record<string, unknown> | null };
  return { billing, plan: normalizePlan(plan) };
}

/** Throws BillingBlockedError when the account may not send right now. */
export async function assertAccountActive(accountId: string): Promise<BillingSnapshot> {
  const snapshot = await loadBilling(accountId);
  const block = accessBlock(snapshot.billing);
  if (block) throw new BillingBlockedError(block, BLOCK_MESSAGES[block]);
  return snapshot;
}

export type PlanFeature = 'ai' | 'api' | 'flows';

const FEATURE_FLAG: Record<PlanFeature, keyof Pick<Plan, 'ai_enabled' | 'api_enabled' | 'flows_enabled'>> = {
  ai: 'ai_enabled',
  api: 'api_enabled',
  flows: 'flows_enabled',
};

const FEATURE_NAMES: Record<PlanFeature, string> = {
  ai: 'The AI assistant',
  api: 'The public API',
  flows: 'Flows',
};

/** Active account AND a plan that includes `feature`. */
export async function assertFeature(accountId: string, feature: PlanFeature): Promise<void> {
  const { plan } = await assertAccountActive(accountId);
  if (plan && !plan[FEATURE_FLAG[feature]]) {
    throw new BillingBlockedError(
      'feature_not_in_plan',
      `${FEATURE_NAMES[feature]} is not included in your plan. Upgrade in Settings → Billing.`,
    );
  }
}

/** Start of the current calendar month, UTC. */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function broadcastUsageThisMonth(accountId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('account_broadcast_usage', {
    target_account_id: accountId,
    since: monthStart().toISOString(),
  });
  if (error) {
    console.error('[billing] broadcast usage failed:', error.message);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}

/**
 * Active account AND room in this month's broadcast quota for
 * `count` more messages.
 */
export async function assertBroadcastQuota(accountId: string, count: number): Promise<void> {
  const { plan } = await assertAccountActive(accountId);
  const limit = plan?.max_broadcast_recipients_per_month;
  if (limit === null || limit === undefined) return;
  const used = await broadcastUsageThisMonth(accountId);
  if (used + count > limit) {
    const left = Math.max(0, limit - used);
    throw new BillingBlockedError(
      'plan_limit',
      `PLAN_LIMIT:broadcast — your plan includes ${limit} broadcast messages a month and ${left} are left. Upgrade in Settings → Billing to send more.`,
    );
  }
}

/** Route helper: 402 JSON for billing errors, null for anything else. */
export function billingErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof BillingBlockedError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return null;
}
