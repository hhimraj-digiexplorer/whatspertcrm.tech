// ============================================================
// How a Razorpay subscription update changes an account's billing.
//
// Pure: given the current billing row and a subscription snapshot
// (from a webhook or a fetch after Checkout), return the columns to
// write — or null to leave the row alone. Both the webhook and the
// Checkout verify route go through this, so they can't disagree.
// ============================================================

import type { AccountBilling, BillingCycle, BillingStatus } from './plans';
import { mapSubscriptionStatus, unixToIso, type RazorpaySubscription } from './razorpay';

export type BillingPatch = Partial<
  Pick<
    AccountBilling,
    'plan_id' | 'status' | 'billing_cycle' | 'current_period_end' | 'razorpay_subscription_id'
  >
>;

function isCycle(v: unknown): v is BillingCycle {
  return v === 'monthly' || v === 'yearly';
}

/**
 * @param current  the account's billing row (null if missing)
 * @param sub      Razorpay subscription entity
 * @param knownPlanIds  plan ids that exist locally (guards notes.plan_id)
 */
export function computeSubscriptionPatch(
  current: Pick<AccountBilling, 'razorpay_subscription_id' | 'plan_id'> | null,
  sub: RazorpaySubscription,
  knownPlanIds: ReadonlySet<string>,
): BillingPatch | null {
  const status: BillingStatus | null = mapSubscriptionStatus(sub.status);
  if (!status) return null;

  const isCurrent =
    !current?.razorpay_subscription_id || current.razorpay_subscription_id === sub.id;

  // An update for an older subscription (replaced on a plan change)
  // must not touch the account — e.g. its cancellation arriving after
  // the new plan is live. Only a newly *active* subscription may take
  // over the slot.
  if (!isCurrent && status !== 'active') return null;

  const patch: BillingPatch = {
    status,
    razorpay_subscription_id: sub.id,
  };
  const periodEnd = unixToIso(sub.current_end);
  if (periodEnd) patch.current_period_end = periodEnd;

  const notePlan = sub.notes?.plan_id;
  if (status === 'active' && notePlan && knownPlanIds.has(notePlan)) {
    patch.plan_id = notePlan;
  }
  const noteCycle = sub.notes?.cycle;
  if (status === 'active' && isCycle(noteCycle)) patch.billing_cycle = noteCycle;

  return patch;
}
