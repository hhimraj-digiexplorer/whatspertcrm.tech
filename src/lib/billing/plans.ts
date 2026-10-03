// ============================================================
// Plans & account billing — pure types and rules (client + server).
//
// Data lives in `plans` and `account_billing` (migration 043). This
// module decides what a billing row *means*: is the account usable,
// how many trial days are left, which limit an error refers to.
// Nothing here touches the network, so it's shared by the UI, the API
// routes and the tests.
// ============================================================

export type BillingStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'expired';

export type BillingCycle = 'monthly' | 'yearly';

export interface Plan {
  id: string;
  name: string;
  description: string;
  price_monthly_inr: number;
  price_yearly_inr: number;
  razorpay_plan_id_monthly: string | null;
  razorpay_plan_id_yearly: string | null;
  /** null = unlimited, for every max_* field. */
  max_members: number | null;
  max_contacts: number | null;
  max_broadcast_recipients_per_month: number | null;
  ai_enabled: boolean;
  flows_enabled: boolean;
  api_enabled: boolean;
  features: string[];
  is_public: boolean;
  is_trial: boolean;
  sort_order: number;
}

export interface AccountBilling {
  account_id: string;
  plan_id: string;
  status: BillingStatus;
  billing_cycle: BillingCycle | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  razorpay_subscription_id: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
}

/** Why an account can't be used right now, or null when it can. */
export type AccessBlock = 'suspended' | 'trial_ended' | 'expired' | null;

/**
 * Days a paid account keeps working after a failed renewal
 * (`past_due`) while Razorpay retries the charge.
 */
export const PAST_DUE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether the account may send messages and change data.
 * Suspension always wins; then the trial clock; then the paid period.
 * A cancelled subscription stays usable until its period ends.
 */
export function accessBlock(
  billing: Pick<
    AccountBilling,
    'status' | 'trial_ends_at' | 'current_period_end' | 'suspended_at'
  > | null,
  now: Date = new Date(),
): AccessBlock {
  // No row (pre-043 data or a race at signup) — don't lock anyone out.
  if (!billing) return null;
  if (billing.suspended_at) return 'suspended';

  const t = now.getTime();
  switch (billing.status) {
    case 'trialing':
      if (billing.trial_ends_at && Date.parse(billing.trial_ends_at) <= t) {
        return 'trial_ended';
      }
      return null;
    case 'active':
      return null;
    case 'past_due': {
      const end = billing.current_period_end
        ? Date.parse(billing.current_period_end)
        : NaN;
      if (Number.isFinite(end) && end + PAST_DUE_GRACE_DAYS * DAY_MS <= t) {
        return 'expired';
      }
      return null;
    }
    case 'cancelled': {
      const end = billing.current_period_end
        ? Date.parse(billing.current_period_end)
        : NaN;
      if (!Number.isFinite(end) || end <= t) return 'expired';
      return null;
    }
    case 'expired':
      return 'expired';
  }
}

/** Whole days left in the trial (0 when ended or not trialing). */
export function trialDaysLeft(
  billing: Pick<AccountBilling, 'status' | 'trial_ends_at'> | null,
  now: Date = new Date(),
): number {
  if (!billing || billing.status !== 'trialing' || !billing.trial_ends_at) {
    return 0;
  }
  const ms = Date.parse(billing.trial_ends_at) - now.getTime();
  return ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
}

/** Limits the DB triggers raise as `PLAN_LIMIT:<kind>`. */
export type PlanLimitKind = 'contacts' | 'members' | 'broadcast';

/**
 * Pull the limit kind out of a Postgres / PostgREST error message, e.g.
 * `PLAN_LIMIT:contacts`. Returns null for any other error.
 */
export function parsePlanLimitError(message: unknown): PlanLimitKind | null {
  if (typeof message !== 'string') return null;
  const m = /PLAN_LIMIT:(contacts|members|broadcast)/.exec(message);
  return m ? (m[1] as PlanLimitKind) : null;
}

/** Price for a cycle, in whole rupees. */
export function planPrice(plan: Plan, cycle: BillingCycle): number {
  return cycle === 'yearly' ? plan.price_yearly_inr : plan.price_monthly_inr;
}

/** Razorpay plan id for a cycle, or null when it can't be bought online. */
export function razorpayPlanId(plan: Plan, cycle: BillingCycle): string | null {
  const id =
    cycle === 'yearly'
      ? plan.razorpay_plan_id_yearly
      : plan.razorpay_plan_id_monthly;
  return id && id.trim() ? id.trim() : null;
}

/** Normalise a `features` value read from JSONB. */
export function planFeatures(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : [];
}

/** Monthly recurring revenue of one billing row, in rupees. */
export function monthlyRevenue(
  plan: Pick<Plan, 'price_monthly_inr' | 'price_yearly_inr'>,
  billing: Pick<AccountBilling, 'status' | 'billing_cycle'>,
): number {
  if (billing.status !== 'active' && billing.status !== 'past_due') return 0;
  if (billing.billing_cycle === 'yearly') return Math.round(plan.price_yearly_inr / 12);
  return plan.price_monthly_inr;
}
