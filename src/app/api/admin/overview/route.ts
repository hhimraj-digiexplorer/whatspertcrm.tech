import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/admin/super-admin';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { accessBlock, monthlyRevenue, type AccountBilling, type Plan } from '@/lib/billing/plans';

// GET /api/admin/overview — platform-wide numbers for the admin home.
export async function GET() {
  try {
    await requireSuperAdmin();
    const db = supabaseAdmin();
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [{ data: rows, error }, { count: newAccounts }, { count: messages30d }] =
      await Promise.all([
        db.from('account_billing').select('status, billing_cycle, plan_id, trial_ends_at, current_period_end, suspended_at, plan:plans(id, name, price_monthly_inr, price_yearly_inr)'),
        db.from('accounts').select('id', { count: 'exact', head: true }).gte('created_at', since30),
        db.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', since30),
      ]);
    if (error) throw error;

    const byStatus: Record<string, number> = {
      trialing: 0, active: 0, past_due: 0, cancelled: 0, expired: 0, suspended: 0, blocked: 0,
    };
    const byPlan: Record<string, { name: string; accounts: number; mrr: number }> = {};
    let mrr = 0;

    for (const r of (rows ?? []) as unknown as (AccountBilling & { plan: Plan | null })[]) {
      if (r.suspended_at) byStatus.suspended++;
      else byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (accessBlock(r)) byStatus.blocked++;
      const revenue = r.plan ? monthlyRevenue(r.plan, r) : 0;
      mrr += revenue;
      const key = r.plan_id;
      byPlan[key] ??= { name: r.plan?.name ?? key, accounts: 0, mrr: 0 };
      byPlan[key].accounts++;
      byPlan[key].mrr += revenue;
    }

    return NextResponse.json({
      totalAccounts: rows?.length ?? 0,
      newAccounts30d: newAccounts ?? 0,
      messages30d: messages30d ?? 0,
      mrr,
      arr: mrr * 12,
      byStatus,
      byPlan,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
