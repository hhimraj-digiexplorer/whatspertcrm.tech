import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  insertError: null as { code: string; message: string } | null,
  deletes: [] as string[],
  billing: null as Record<string, unknown> | null,
  writeBillingPatch: vi.fn(),
  cancelSubscription: vi.fn(),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserts.push(row);
        return { error: h.insertError };
      },
      delete: () => ({
        eq: async (_col: string, value: string) => {
          h.deletes.push(value);
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock('@/lib/billing/server', () => ({
  loadBilling: async () => ({ billing: h.billing, plan: null }),
}));
vi.mock('@/lib/billing/account-billing', () => ({
  knownPlanIds: async () => new Set(['trial', 'growth']),
  writeBillingPatch: h.writeBillingPatch,
}));
vi.mock('@/lib/billing/razorpay', async (orig) => ({
  ...(await orig<typeof import('@/lib/billing/razorpay')>()),
  cancelSubscription: h.cancelSubscription,
}));

import { POST } from './route';

const SECRET = 'whsec_test';

function request(body: unknown, { sign = true, eventId = 'evt_1' } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'x-razorpay-event-id': eventId };
  if (sign) headers['x-razorpay-signature'] = createHmac('sha256', SECRET).update(raw).digest('hex');
  return new Request('http://x/api/billing/webhook', { method: 'POST', body: raw, headers });
}

const activated = (subId = 'sub_new') => ({
  event: 'subscription.activated',
  payload: {
    subscription: {
      entity: {
        id: subId,
        plan_id: 'plan_rzp',
        status: 'active',
        current_end: 1_790_000_000,
        notes: { account_id: 'acc-1', plan_id: 'growth', cycle: 'monthly' },
      },
    },
  },
});

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  h.inserts = [];
  h.insertError = null;
  h.deletes = [];
  h.billing = { account_id: 'acc-1', plan_id: 'trial', status: 'trialing', razorpay_subscription_id: null };
  h.writeBillingPatch.mockReset().mockResolvedValue(undefined);
  h.cancelSubscription.mockReset().mockResolvedValue({});
});

describe('POST /api/billing/webhook', () => {
  it('rejects an unsigned or wrongly signed body', async () => {
    const res = await POST(request(activated(), { sign: false }));
    expect(res.status).toBe(401);
    expect(h.inserts).toHaveLength(0);
  });

  it('activates the plan from the subscription notes', async () => {
    const res = await POST(request(activated()));
    expect(res.status).toBe(200);
    expect(h.writeBillingPatch).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ status: 'active', plan_id: 'growth', razorpay_subscription_id: 'sub_new' }),
    );
    expect(h.inserts[0]).toMatchObject({ provider_event_id: 'evt_1', account_id: 'acc-1' });
  });

  it('acknowledges a redelivered event without applying it again', async () => {
    h.insertError = { code: '23505', message: 'duplicate' };
    const res = await POST(request(activated()));
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(h.writeBillingPatch).not.toHaveBeenCalled();
  });

  it('cancels the replaced subscription on a plan change', async () => {
    h.billing = { ...h.billing!, status: 'active', razorpay_subscription_id: 'sub_old' };
    await POST(request(activated('sub_new')));
    expect(h.cancelSubscription).toHaveBeenCalledWith('sub_old', { atCycleEnd: false });
  });

  it('returns 500 and forgets the event when applying fails, so Razorpay retries', async () => {
    h.writeBillingPatch.mockRejectedValue(new Error('db down'));
    const res = await POST(request(activated()));
    expect(res.status).toBe(500);
    expect(h.deletes).toEqual(['evt_1']);
  });
});
