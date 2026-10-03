import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { computeSubscriptionPatch } from '@/lib/billing/apply';
import { knownPlanIds, writeBillingPatch } from '@/lib/billing/account-billing';
import { loadBilling } from '@/lib/billing/server';
import {
  RazorpayApiError,
  cancelSubscription,
  fetchSubscription,
  verifySubscriptionPayment,
} from '@/lib/billing/razorpay';

// POST /api/billing/verify — called by the browser when Razorpay
// Checkout reports success. Applies the plan straight away so the
// customer doesn't wait for the webhook (which applies the same patch
// again, harmlessly).
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner');
    const body = await request.json().catch(() => ({}));
    const paymentId = String(body?.razorpay_payment_id ?? '');
    const subscriptionId = String(body?.razorpay_subscription_id ?? '');
    const signature = String(body?.razorpay_signature ?? '');

    const ok = verifySubscriptionPayment(
      { paymentId, subscriptionId, signature },
      process.env.RAZORPAY_KEY_SECRET ?? '',
    );
    if (!ok) {
      return NextResponse.json({ error: 'Payment could not be verified' }, { status: 400 });
    }

    // Trust Razorpay's record, not the browser: the subscription must
    // have been created for this account.
    const sub = await fetchSubscription(subscriptionId);
    if (sub.notes?.account_id !== ctx.accountId) {
      return NextResponse.json({ error: 'Payment does not belong to this account' }, { status: 403 });
    }

    // A verified first payment means the subscription is live even if
    // Razorpay still reports it as authenticated for a moment.
    const live = sub.status === 'created' || sub.status === 'authenticated'
      ? { ...sub, status: 'active' }
      : sub;

    const { billing } = await loadBilling(ctx.accountId);
    const patch = computeSubscriptionPatch(billing, live, await knownPlanIds());
    if (patch) await writeBillingPatch(ctx.accountId, patch);

    // Plan change: stop the subscription this one replaced, now, so
    // the customer isn't charged twice.
    const previous = billing?.razorpay_subscription_id;
    if (patch?.status === 'active' && previous && previous !== sub.id) {
      await cancelSubscription(previous, { atCycleEnd: false }).catch((err) =>
        console.error('[billing/verify] could not cancel replaced subscription:', err),
      );
    }

    return NextResponse.json({ success: true, status: patch?.status ?? billing?.status ?? null });
  } catch (err) {
    if (err instanceof RazorpayApiError) {
      console.error('[billing/verify] Razorpay error:', err.message);
      return NextResponse.json({ error: 'Could not confirm the payment. If you were charged, it will apply within a few minutes.' }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
