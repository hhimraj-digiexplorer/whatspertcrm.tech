import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadPlans } from '@/lib/billing/account-billing';
import { razorpayPlanId, type BillingCycle } from '@/lib/billing/plans';
import {
  RazorpayApiError,
  RazorpayNotConfiguredError,
  createSubscription,
  razorpayKeyId,
} from '@/lib/billing/razorpay';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/billing/checkout { plan_id, cycle }
// Creates a Razorpay subscription for the chosen plan and returns what
// the browser needs to open Razorpay Checkout. Nothing is written to
// our database here — the account changes only once the payment is
// verified (/api/billing/verify) or Razorpay's webhook confirms it.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner');

    const limit = checkRateLimit(`billing-checkout:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const cycle: BillingCycle = body?.cycle === 'yearly' ? 'yearly' : 'monthly';
    const planId = typeof body?.plan_id === 'string' ? body.plan_id : '';

    const plan = (await loadPlans({ publicOnly: true })).find((p) => p.id === planId);
    if (!plan || plan.is_trial) {
      return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
    }
    const rzpPlanId = razorpayPlanId(plan, cycle);
    if (!rzpPlanId) {
      return NextResponse.json(
        { error: 'This plan cannot be bought online yet. Please contact us.' },
        { status: 400 },
      );
    }

    const sub = await createSubscription({
      razorpayPlanId: rzpPlanId,
      cycle,
      accountId: ctx.accountId,
      planId: plan.id,
    });

    return NextResponse.json({
      key_id: razorpayKeyId(),
      subscription_id: sub.id,
      plan_name: plan.name,
      account_name: ctx.account.name,
    });
  } catch (err) {
    if (err instanceof RazorpayNotConfiguredError) {
      return NextResponse.json({ error: 'Online payments are not set up yet.' }, { status: 503 });
    }
    if (err instanceof RazorpayApiError) {
      console.error('[billing/checkout] Razorpay error:', err.message);
      return NextResponse.json({ error: 'Could not start the payment. Try again.' }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
