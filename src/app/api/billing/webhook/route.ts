import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { computeSubscriptionPatch } from '@/lib/billing/apply';
import { knownPlanIds, writeBillingPatch } from '@/lib/billing/account-billing';
import { loadBilling } from '@/lib/billing/server';
import {
  cancelSubscription,
  verifyWebhookSignature,
  type RazorpaySubscription,
} from '@/lib/billing/razorpay';

// POST /api/billing/webhook — Razorpay webhook receiver.
//
// Set it up in Razorpay Dashboard → Settings → Webhooks:
//   URL:    https://<your-domain>/api/billing/webhook
//   Secret: the value of RAZORPAY_WEBHOOK_SECRET
//   Events: subscription.* (activated, charged, pending, halted,
//           cancelled, completed, paused, resumed)
//
// Every event is logged once in billing_events (unique on Razorpay's
// event id), so redeliveries are acknowledged without re-applying.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
  if (!verifyWebhookSignature(rawBody, request.headers.get('x-razorpay-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: {
    event?: string;
    payload?: { subscription?: { entity?: RazorpaySubscription } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event ?? 'unknown';
  const sub = event.payload?.subscription?.entity;
  const accountId = sub?.notes?.account_id ?? null;
  const eventId =
    request.headers.get('x-razorpay-event-id') ?? `${eventType}:${sub?.id ?? 'none'}:${sub?.current_end ?? ''}`;

  const db = supabaseAdmin();
  const logRow = { provider_event_id: eventId, event_type: eventType, account_id: accountId, payload: event };
  let { error: logErr } = await db.from('billing_events').insert(logRow);
  if (logErr?.code === '23503') {
    // account_id points at a deleted account — keep the event, unlinked.
    ({ error: logErr } = await db.from('billing_events').insert({ ...logRow, account_id: null }));
  }
  if (logErr?.code === '23505') {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (logErr) console.error('[billing/webhook] event log failed:', logErr.message);

  // Only subscription events change billing; payment.* etc. are logged.
  if (!sub || !accountId || !eventType.startsWith('subscription.')) {
    return NextResponse.json({ received: true });
  }

  try {
    const { billing } = await loadBilling(accountId);
    if (!billing) return NextResponse.json({ received: true, ignored: 'unknown account' });

    const patch = computeSubscriptionPatch(billing, sub, await knownPlanIds());
    if (patch) await writeBillingPatch(accountId, patch);

    const previous = billing.razorpay_subscription_id;
    if (patch?.status === 'active' && previous && previous !== sub.id) {
      await cancelSubscription(previous, { atCycleEnd: false }).catch((err) =>
        console.error('[billing/webhook] could not cancel replaced subscription:', err),
      );
    }
    return NextResponse.json({ received: true, applied: Boolean(patch) });
  } catch (err) {
    // 500 → Razorpay retries. Remove the log row so the retry is applied.
    console.error('[billing/webhook] apply failed:', err);
    await db.from('billing_events').delete().eq('provider_event_id', eventId);
    return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
  }
}
