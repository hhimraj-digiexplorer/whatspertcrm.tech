"use client";

import { BRAND_COLOR, BRAND_NAME } from "@/lib/brand";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (resp: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Razorpay Checkout"));
    };
    document.body.appendChild(el);
  });
  return scriptPromise;
}

export type CheckoutOutcome =
  | { kind: "paid"; response: RazorpaySuccess }
  | { kind: "dismissed" }
  | { kind: "unavailable" };

/**
 * Open Razorpay Checkout for a subscription created by
 * /api/billing/checkout. Resolves once the customer pays or closes the
 * window. A failed attempt keeps the window open (Razorpay lets them
 * retry), so it's reported through `onPaymentFailed` instead.
 */
export async function openSubscriptionCheckout(args: {
  keyId: string;
  subscriptionId: string;
  description: string;
  prefill?: { name?: string; email?: string };
  onPaymentFailed?: (message: string) => void;
}): Promise<CheckoutOutcome> {
  try {
    await loadScript();
  } catch {
    return { kind: "unavailable" };
  }
  const Razorpay = window.Razorpay;
  if (!Razorpay) return { kind: "unavailable" };

  return new Promise<CheckoutOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: CheckoutOutcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };
    const rzp = new Razorpay({
      key: args.keyId,
      subscription_id: args.subscriptionId,
      name: BRAND_NAME,
      description: args.description,
      prefill: args.prefill,
      theme: { color: BRAND_COLOR },
      handler: (response: RazorpaySuccess) => done({ kind: "paid", response }),
      modal: { ondismiss: () => done({ kind: "dismissed" }) },
    });
    rzp.on("payment.failed", (resp) =>
      args.onPaymentFailed?.(resp.error?.description ?? ""),
    );
    rzp.open();
  });
}
