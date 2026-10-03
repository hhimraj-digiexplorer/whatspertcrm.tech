import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/admin/super-admin';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { knownPlanIds } from '@/lib/billing/account-billing';
import type { BillingStatus } from '@/lib/billing/plans';

const STATUSES: BillingStatus[] = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * PATCH /api/admin/accounts/:id — operator changes to one account.
 * Body (all optional):
 *   plan_id, status, billing_cycle
 *   current_period_end   ISO date — for manual (offline) payments
 *   extend_trial_days    1–365, added to max(now, trial_ends_at)
 *   suspend              { reason } to suspend, null to restore
 *   admin_notes          free text, ≤ 2000 chars
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireSuperAdmin();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid account id' }, { status: 400 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });

    const db = supabaseAdmin();
    const { data: current, error: loadErr } = await db
      .from('account_billing')
      .select('trial_ends_at')
      .eq('account_id', id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!current) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const patch: Record<string, unknown> = {};

    if (body.plan_id !== undefined) {
      if (typeof body.plan_id !== 'string' || !(await knownPlanIds()).has(body.plan_id)) {
        return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
      }
      patch.plan_id = body.plan_id;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as BillingStatus)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.billing_cycle !== undefined) {
      if (body.billing_cycle !== null && body.billing_cycle !== 'monthly' && body.billing_cycle !== 'yearly') {
        return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
      }
      patch.billing_cycle = body.billing_cycle;
    }
    if (body.current_period_end !== undefined) {
      const t = typeof body.current_period_end === 'string' ? Date.parse(body.current_period_end) : NaN;
      if (body.current_period_end !== null && !Number.isFinite(t)) {
        return NextResponse.json({ error: 'Invalid period end' }, { status: 400 });
      }
      patch.current_period_end = body.current_period_end === null ? null : new Date(t).toISOString();
    }
    if (body.extend_trial_days !== undefined) {
      const days = Number(body.extend_trial_days);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return NextResponse.json({ error: 'extend_trial_days must be 1–365' }, { status: 400 });
      }
      const base = Math.max(Date.now(), current.trial_ends_at ? Date.parse(current.trial_ends_at) : 0);
      patch.trial_ends_at = new Date(base + days * 86_400_000).toISOString();
      patch.status ??= 'trialing';
    }
    if (body.suspend !== undefined) {
      if (body.suspend === null) {
        patch.suspended_at = null;
        patch.suspended_reason = null;
      } else {
        const reason = (body.suspend as { reason?: unknown })?.reason;
        patch.suspended_at = new Date().toISOString();
        patch.suspended_reason = typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null;
      }
    }
    if (body.admin_notes !== undefined) {
      if (typeof body.admin_notes !== 'string') {
        return NextResponse.json({ error: 'admin_notes must be text' }, { status: 400 });
      }
      patch.admin_notes = body.admin_notes.slice(0, 2000);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { error } = await db.from('account_billing').update(patch).eq('account_id', id);
    if (error) throw error;

    console.info('[admin] account billing updated', { by: admin.email, account: id, fields: Object.keys(patch) });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
