import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';

const h = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  current: { trial_ends_at: null as string | null } as { trial_ends_at: string | null } | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/admin/super-admin', () => ({ requireSuperAdmin: h.requireSuperAdmin }));
vi.mock('@/lib/billing/account-billing', () => ({
  knownPlanIds: async () => new Set(['trial', 'growth']),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.current, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          h.updates.push(patch);
          return { error: null };
        },
      }),
    }),
  }),
}));

import { PATCH } from './route';

const ID = '11111111-1111-1111-1111-111111111111';
const call = (body: unknown, id = ID) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  h.requireSuperAdmin.mockReset().mockResolvedValue({ userId: 'u', email: 'ops@x.in' });
  h.current = { trial_ends_at: null };
  h.updates = [];
});

describe('PATCH /api/admin/accounts/:id', () => {
  it('is closed to anyone who is not a super-admin', async () => {
    h.requireSuperAdmin.mockRejectedValue(new ForbiddenError());
    const res = await call({ plan_id: 'growth' });
    expect(res.status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });

  it('changes the plan and rejects unknown plans', async () => {
    expect((await call({ plan_id: 'growth', status: 'active' })).status).toBe(200);
    expect(h.updates[0]).toEqual({ plan_id: 'growth', status: 'active' });
    expect((await call({ plan_id: 'gold' })).status).toBe(400);
  });

  it('extends a trial from now when it already ended', async () => {
    h.current = { trial_ends_at: '2020-01-01T00:00:00Z' };
    const before = Date.now();
    await call({ extend_trial_days: 7 });
    const ends = Date.parse(h.updates[0].trial_ends_at as string);
    expect(ends).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
    expect(h.updates[0].status).toBe('trialing');
  });

  it('suspends with a reason and restores with null', async () => {
    await call({ suspend: { reason: ' Unpaid invoice ' } });
    expect(h.updates[0]).toMatchObject({ suspended_reason: 'Unpaid invoice' });
    expect(typeof h.updates[0].suspended_at).toBe('string');
    await call({ suspend: null });
    expect(h.updates[1]).toEqual({ suspended_at: null, suspended_reason: null });
  });

  it('validates input', async () => {
    expect((await call({ status: 'free' })).status).toBe(400);
    expect((await call({ extend_trial_days: 0 })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ plan_id: 'growth' }, 'not-a-uuid')).status).toBe(400);
  });

  it('404s for an account with no billing row', async () => {
    h.current = null;
    expect((await call({ plan_id: 'growth' })).status).toBe(404);
  });
});
