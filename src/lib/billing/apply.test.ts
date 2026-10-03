import { describe, expect, it } from 'vitest';
import { computeSubscriptionPatch } from './apply';
import type { RazorpaySubscription } from './razorpay';

const PLANS = new Set(['trial', 'starter', 'growth']);
const sub = (over: Partial<RazorpaySubscription> = {}): RazorpaySubscription => ({
  id: 'sub_new',
  plan_id: 'plan_rzp',
  status: 'active',
  current_end: 1_790_000_000,
  notes: { account_id: 'acc', plan_id: 'growth', cycle: 'monthly' },
  ...over,
});

describe('computeSubscriptionPatch', () => {
  it('activates a trial account on its first paid subscription', () => {
    expect(
      computeSubscriptionPatch({ razorpay_subscription_id: null, plan_id: 'trial' }, sub(), PLANS),
    ).toEqual({
      status: 'active',
      razorpay_subscription_id: 'sub_new',
      current_period_end: '2026-09-21T14:13:20.000Z',
      plan_id: 'growth',
      billing_cycle: 'monthly',
    });
  });

  it('lets a new active subscription replace the old one (plan change)', () => {
    const patch = computeSubscriptionPatch(
      { razorpay_subscription_id: 'sub_old', plan_id: 'starter' },
      sub(),
      PLANS,
    );
    expect(patch?.razorpay_subscription_id).toBe('sub_new');
    expect(patch?.plan_id).toBe('growth');
  });

  it('ignores a late cancellation of the replaced subscription', () => {
    expect(
      computeSubscriptionPatch(
        { razorpay_subscription_id: 'sub_new', plan_id: 'growth' },
        sub({ id: 'sub_old', status: 'cancelled' }),
        PLANS,
      ),
    ).toBeNull();
  });

  it('marks the current subscription past_due / cancelled without changing plan', () => {
    const current = { razorpay_subscription_id: 'sub_new', plan_id: 'growth' };
    expect(computeSubscriptionPatch(current, sub({ status: 'pending' }), PLANS)).toEqual({
      status: 'past_due',
      razorpay_subscription_id: 'sub_new',
      current_period_end: '2026-09-21T14:13:20.000Z',
    });
    expect(computeSubscriptionPatch(current, sub({ status: 'cancelled' }), PLANS)?.status).toBe(
      'cancelled',
    );
  });

  it('ignores pre-payment states and unknown plan ids', () => {
    expect(computeSubscriptionPatch(null, sub({ status: 'created' }), PLANS)).toBeNull();
    const patch = computeSubscriptionPatch(
      null,
      sub({ notes: { account_id: 'acc', plan_id: 'nope' } }),
      PLANS,
    );
    expect(patch?.plan_id).toBeUndefined();
  });
});
