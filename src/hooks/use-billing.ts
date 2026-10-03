"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AccessBlock, AccountBilling, Plan } from "@/lib/billing/plans";

export interface BillingPlanOption extends Omit<Plan, "razorpay_plan_id_monthly" | "razorpay_plan_id_yearly"> {
  buyable_monthly: boolean;
  buyable_yearly: boolean;
}

export interface BillingState {
  billing: AccountBilling | null;
  plan: Plan | null;
  usage: { contacts: number; members: number; broadcastsThisMonth: number };
  block: AccessBlock;
  trialDaysLeft: number;
  canManage: boolean;
  checkoutReady: boolean;
  plans: BillingPlanOption[];
}

// One shared copy for the whole dashboard: the banner in the shell and
// the Settings → Billing panel read the same fetch, and a refresh after
// checkout updates both.
let snapshot: { data: BillingState | null; error: boolean; loading: boolean } = {
  data: null,
  error: false,
  loading: true,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: typeof snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

async function load(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/billing", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      emit({ data: (await res.json()) as BillingState, error: false, loading: false });
    } catch {
      emit({ ...snapshot, error: true, loading: false });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBilling() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

  useEffect(() => {
    if (!state.data && !inflight) void load();
  }, [state.data]);

  const refresh = useCallback(() => load(), []);
  return { ...state, refresh };
}
