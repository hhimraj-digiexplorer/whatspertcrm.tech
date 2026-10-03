import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { writeBillingPatch } from '@/lib/billing/account-billing';
import { loadBilling } from '@/lib/billing/server';
import { RazorpayApiError, cancelSubscription, unixToIso } from '@/lib/billing/razorpay';

// POST /api/billing/cancel — stop renewing. The account keeps its plan
// until the end of the period it already paid for.
export async function POST() {
  try {
    const ctx = await requireRole('owner');
    const { billing } = await loadBilling(ctx.accountId);
    if (!billing?.razorpay_subscription_id || billing.status !== 'active') {
      return NextResponse.json({ error: 'There is no active subscription to cancel' }, { status: 400 });
    }

    const sub = await cancelSubscription(billing.razorpay_subscription_id);
    const periodEnd = unixToIso(sub.current_end) ?? billing.current_period_end;
    await writeBillingPatch(ctx.accountId, { status: 'cancelled', current_period_end: periodEnd });

    return NextResponse.json({ success: true, current_period_end: periodEnd });
  } catch (err) {
    if (err instanceof RazorpayApiError) {
      console.error('[billing/cancel] Razorpay error:', err.message);
      return NextResponse.json({ error: 'Could not cancel right now. Try again.' }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
