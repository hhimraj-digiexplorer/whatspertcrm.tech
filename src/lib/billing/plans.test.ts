import { describe, expect, it } from 'vitest';
import {
  accessBlock,
  monthlyRevenue,
  parsePlanLimitError,
  planFeatures,
  razorpayPlanId,
  trialDaysLeft,
  type Plan,
} from './plans';

const NOW = new Date('2026-10-03T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

const base = {
  status: 'trialing' as const,
  trial_ends_at: inDays(5),
  current_period_end: null,
  suspended_at: null,
};

describe('accessBlock', () => {
  it('allows a running trial and blocks an ended one', () => {
    expect(accessBlock(base, NOW)).toBeNull();
    expect(accessBlock({ ...base, trial_ends_at: inDays(-1) }, NOW)).toBe('trial_ended');
  });

  it('suspension wins over everything', () => {
    expect(accessBlock({ ...base, status: 'active', suspended_at: inDays(-1) }, NOW)).toBe(
      'suspended',
    );
  });

  it('keeps a cancelled plan until the period ends', () => {
    expect(accessBlock({ ...base, status: 'cancelled', current_period_end: inDays(3) }, NOW)).toBeNull();
    expect(accessBlock({ ...base, status: 'cancelled', current_period_end: inDays(-1) }, NOW)).toBe(
      'expired',
    );
  });

  it('gives past_due a grace period', () => {
    expect(accessBlock({ ...base, status: 'past_due', current_period_end: inDays(-3) }, NOW)).toBeNull();
    expect(accessBlock({ ...base, status: 'past_due', current_period_end: inDays(-8) }, NOW)).toBe(
      'expired',
    );
  });

  it('does not lock out an account with no billing row', () => {
    expect(accessBlock(null, NOW)).toBeNull();
  });
});

describe('trialDaysLeft', () => {
  it('rounds up partial days and floors at zero', () => {
    expect(trialDaysLeft({ status: 'trialing', trial_ends_at: inDays(4.2) }, NOW)).toBe(5);
    expect(trialDaysLeft({ status: 'trialing', trial_ends_at: inDays(-2) }, NOW)).toBe(0);
    expect(trialDaysLeft({ status: 'active', trial_ends_at: inDays(4) }, NOW)).toBe(0);
  });
});

describe('parsePlanLimitError', () => {
  it('finds the limit kind in a Postgres error message', () => {
    expect(parsePlanLimitError('PLAN_LIMIT:contacts')).toBe('contacts');
    expect(parsePlanLimitError('ERROR: PLAN_LIMIT:members (P0001)')).toBe('members');
    expect(parsePlanLimitError('duplicate key value')).toBeNull();
    expect(parsePlanLimitError(undefined)).toBeNull();
  });
});

describe('plan helpers', () => {
  const plan = {
    price_monthly_inr: 999,
    price_yearly_inr: 9990,
    razorpay_plan_id_monthly: ' plan_M ',
    razorpay_plan_id_yearly: '',
  } as Plan;

  it('returns a trimmed Razorpay plan id or null', () => {
    expect(razorpayPlanId(plan, 'monthly')).toBe('plan_M');
    expect(razorpayPlanId(plan, 'yearly')).toBeNull();
  });

  it('computes MRR for paying accounts only', () => {
    expect(monthlyRevenue(plan, { status: 'active', billing_cycle: 'monthly' })).toBe(999);
    expect(monthlyRevenue(plan, { status: 'active', billing_cycle: 'yearly' })).toBe(833);
    expect(monthlyRevenue(plan, { status: 'trialing', billing_cycle: null })).toBe(0);
  });

  it('keeps only string features', () => {
    expect(planFeatures(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(planFeatures(null)).toEqual([]);
  });
});
