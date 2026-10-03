import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  mapSubscriptionStatus,
  unixToIso,
  verifySubscriptionPayment,
  verifyWebhookSignature,
} from './razorpay';

const hmac = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');

describe('verifySubscriptionPayment', () => {
  it('accepts the signature Razorpay produces and rejects tampering', () => {
    const signature = hmac('secret', 'pay_1|sub_1');
    expect(
      verifySubscriptionPayment({ paymentId: 'pay_1', subscriptionId: 'sub_1', signature }, 'secret'),
    ).toBe(true);
    expect(
      verifySubscriptionPayment({ paymentId: 'pay_1', subscriptionId: 'sub_2', signature }, 'secret'),
    ).toBe(false);
    expect(
      verifySubscriptionPayment({ paymentId: 'pay_1', subscriptionId: 'sub_1', signature }, ''),
    ).toBe(false);
  });
});

describe('verifyWebhookSignature', () => {
  it('checks the raw body against the webhook secret', () => {
    const body = '{"event":"subscription.charged"}';
    expect(verifyWebhookSignature(body, hmac('whsec', body), 'whsec')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', hmac('whsec', body), 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, null, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, 'short', 'whsec')).toBe(false);
  });
});

describe('mapSubscriptionStatus', () => {
  it('maps Razorpay states and ignores pre-payment ones', () => {
    expect(mapSubscriptionStatus('active')).toBe('active');
    expect(mapSubscriptionStatus('pending')).toBe('past_due');
    expect(mapSubscriptionStatus('halted')).toBe('expired');
    expect(mapSubscriptionStatus('cancelled')).toBe('cancelled');
    expect(mapSubscriptionStatus('created')).toBeNull();
    expect(mapSubscriptionStatus('authenticated')).toBeNull();
  });
});

describe('unixToIso', () => {
  it('converts seconds and ignores empty values', () => {
    expect(unixToIso(1_790_000_000)).toBe('2026-09-21T14:13:20.000Z');
    expect(unixToIso(null)).toBeNull();
    expect(unixToIso(0)).toBeNull();
  });
});
