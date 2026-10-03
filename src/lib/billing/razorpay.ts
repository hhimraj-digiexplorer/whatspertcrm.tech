// ============================================================
// Razorpay — minimal REST client + signature checks (server only).
//
// We only need four calls (create / fetch / cancel subscription) and
// two HMAC checks, so this talks to the REST API with fetch instead
// of pulling in the SDK.
//
// Env:
//   RAZORPAY_KEY_ID          rzp_live_… / rzp_test_… (also sent to the
//                            browser for Checkout — it is public)
//   RAZORPAY_KEY_SECRET      API secret; signs payment callbacks
//   RAZORPAY_WEBHOOK_SECRET  secret set on the webhook in the Razorpay
//                            dashboard; signs webhook bodies
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingCycle, BillingStatus } from './plans';

const API = 'https://api.razorpay.com/v1';

export class RazorpayNotConfiguredError extends Error {
  constructor() {
    super('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
    this.name = 'RazorpayNotConfiguredError';
  }
}

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RazorpayApiError';
  }
}

export function razorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID?.trim() || null;
}

function credentials(): { id: string; secret: string } {
  const id = razorpayKeyId();
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!id || !secret) throw new RazorpayNotConfiguredError();
  return { id, secret };
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { id, secret } = credentials();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { description?: string };
  } & T;
  if (!res.ok) {
    throw new RazorpayApiError(
      json.error?.description || `Razorpay request failed (HTTP ${res.status})`,
      res.status,
    );
  }
  return json;
}

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  /** Unix seconds; end of the current paid period. */
  current_end: number | null;
  short_url?: string;
  notes?: Record<string, string>;
}

/** How many renewals Razorpay should schedule (it requires a finite count). */
const TOTAL_COUNT: Record<BillingCycle, number> = { monthly: 120, yearly: 10 };

export function createSubscription(args: {
  razorpayPlanId: string;
  cycle: BillingCycle;
  accountId: string;
  planId: string;
}): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>('POST', '/subscriptions', {
    plan_id: args.razorpayPlanId,
    total_count: TOTAL_COUNT[args.cycle],
    quantity: 1,
    customer_notify: 1,
    // Notes come back on every webhook — that's how we map an event to
    // an account without trusting anything the browser sent.
    notes: { account_id: args.accountId, plan_id: args.planId, cycle: args.cycle },
  });
}

export function fetchSubscription(id: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

/**
 * Stop a subscription. `atCycleEnd` (the default) keeps the customer's
 * access until the paid period ends; `false` stops it now — used when
 * a new subscription replaces it on a plan change.
 */
export function cancelSubscription(
  id: string,
  { atCycleEnd = true }: { atCycleEnd?: boolean } = {},
): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(
    'POST',
    `/subscriptions/${encodeURIComponent(id)}/cancel`,
    { cancel_at_cycle_end: atCycleEnd ? 1 : 0 },
  );
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Checkout success callback check: Razorpay signs
 * `${payment_id}|${subscription_id}` with the API key secret.
 */
export function verifySubscriptionPayment(
  args: { paymentId: string; subscriptionId: string; signature: string },
  keySecret: string,
): boolean {
  if (!args.paymentId || !args.subscriptionId || !args.signature || !keySecret) {
    return false;
  }
  const expected = createHmac('sha256', keySecret)
    .update(`${args.paymentId}|${args.subscriptionId}`)
    .digest('hex');
  return safeEqualHex(expected, args.signature);
}

/** Webhook check: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  webhookSecret: string,
): boolean {
  if (!signature || !webhookSecret) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/**
 * Map a Razorpay subscription status onto ours. Returns null for
 * states that shouldn't change anything (created / authenticated —
 * the first charge hasn't settled yet).
 */
export function mapSubscriptionStatus(status: string): BillingStatus | null {
  switch (status) {
    case 'active':
      return 'active';
    case 'pending':
    case 'paused':
      return 'past_due';
    case 'halted':
    case 'completed':
    case 'expired':
      return 'expired';
    case 'cancelled':
      return 'cancelled';
    default:
      return null;
  }
}

export function unixToIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}
