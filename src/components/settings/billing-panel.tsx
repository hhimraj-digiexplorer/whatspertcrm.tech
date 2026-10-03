"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, Check, CreditCard, Gauge, Loader2, Sparkles } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useBilling, type BillingPlanOption } from "@/hooks/use-billing";
import { formatCurrency } from "@/lib/currency";
import type { BillingCycle } from "@/lib/billing/plans";
import { openSubscriptionCheckout } from "@/components/billing/razorpay-checkout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Settings → Billing — the account's plan, usage against its limits,
 * and upgrading / cancelling through Razorpay.
 *
 * Everyone in the account can see it; only the owner can change the
 * plan (the API enforces that too). Data comes from /api/billing via
 * the shared useBilling store, so the trial banner updates as well.
 */
export function BillingPanel() {
  const t = useTranslations("Settings.billing");
  const format = useFormatter();
  const { user, profile } = useAuth();
  const { data, loading, error, refresh } = useBilling();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const date = (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "medium" }) : "—";

  async function choose(plan: BillingPlanOption) {
    setBusyPlan(plan.id);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id, cycle }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || t("checkoutFailed"));
        return;
      }
      const outcome = await openSubscriptionCheckout({
        keyId: body.key_id,
        subscriptionId: body.subscription_id,
        description: t("checkoutDescription", { plan: plan.name }),
        prefill: { name: profile?.full_name ?? undefined, email: user?.email ?? undefined },
        onPaymentFailed: (message) => toast.error(message || t("paymentFailed")),
      });
      if (outcome.kind === "unavailable") {
        toast.error(t("checkoutUnavailable"));
        return;
      }
      if (outcome.kind !== "paid") return;

      const verify = await fetch("/api/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outcome.response),
      });
      const verifyBody = await verify.json().catch(() => ({}));
      if (!verify.ok) {
        toast.error(verifyBody.error || t("verifyFailed"));
      } else {
        toast.success(t("paymentSuccess", { plan: plan.name }));
      }
      await refresh();
    } catch {
      toast.error(t("checkoutFailed"));
    } finally {
      setBusyPlan(null);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || t("cancelFailed"));
        return;
      }
      toast.success(t("cancelled", { date: date(body.current_period_end) }));
      setConfirmCancel(false);
      await refresh();
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !data) {
    return (
      <section className="flex max-w-4xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="max-w-4xl space-y-3">
        <p className="text-sm text-destructive">{t("loadFailed")}</p>
        <Button variant="outline" onClick={() => void refresh()}>
          {t("retry")}
        </Button>
      </section>
    );
  }

  const { billing, plan, usage, block, trialDaysLeft, canManage, checkoutReady, plans } = data;
  const currentPlanId = billing?.plan_id;

  return (
    <section className="max-w-5xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {block === "suspended" && (
        <div className="mb-4 flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-foreground">{t("suspendedTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {billing?.suspended_reason || t("suspendedBody")}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Current plan */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <CreditCard className="size-4 text-primary" />
              {t("currentPlan")}
            </CardTitle>
            <CardDescription>{plan?.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold text-foreground">{plan?.name ?? "—"}</span>
              <StatusBadge status={billing?.status} block={block} label={statusLabel()} />
            </div>
            <p className="text-sm text-muted-foreground">{statusLine()}</p>
            {canManage && billing?.status === "active" && billing.razorpay_subscription_id && (
              <div className="pt-1">
                {confirmCancel ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-foreground">{t("cancelConfirm")}</span>
                    <Button size="sm" variant="destructive" onClick={cancel} disabled={cancelling}>
                      {cancelling && <Loader2 className="size-4 animate-spin" />}
                      {t("cancelYes")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                      {t("cancelNo")}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmCancel(true)}>
                    {t("cancelSubscription")}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Gauge className="size-4 text-primary" />
              {t("usage")}
            </CardTitle>
            <CardDescription>{t("usageDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter label={t("usageContacts")} used={usage.contacts} limit={plan?.max_contacts ?? null} />
            <Meter label={t("usageMembers")} used={usage.members} limit={plan?.max_members ?? null} />
            <Meter
              label={t("usageBroadcasts")}
              used={usage.broadcastsThisMonth}
              limit={plan?.max_broadcast_recipients_per_month ?? null}
            />
          </CardContent>
        </Card>
      </div>

      {/* Plans */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t("choosePlan")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage ? t("choosePlanDesc") : t("ownerOnly")}
          </p>
        </div>
        <div role="radiogroup" aria-label={t("billingCycle")} className="inline-flex rounded-lg border border-border bg-card p-1 text-sm">
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c === "monthly" ? t("toggleMonthly") : t("toggleYearly")}
            </button>
          ))}
        </div>
      </div>

      {canManage && !checkoutReady && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          {t("paymentsNotSetUp")}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId && billing?.status === "active";
          const price = cycle === "yearly" ? p.price_yearly_inr : p.price_monthly_inr;
          const buyable = cycle === "yearly" ? p.buyable_yearly : p.buyable_monthly;
          return (
            <Card key={p.id} className={cn(isCurrent && "border-primary/60 ring-2 ring-primary/30")}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-foreground">
                  {p.name}
                  {isCurrent && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {t("currentBadge")}
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-foreground">
                  <span className="text-3xl font-bold">{formatCurrency(price, "INR")}</span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    {cycle === "yearly" ? t("perYear") : t("perMonth")}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{t("gstNote")}</p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <Button
                    className="w-full"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || !buyable || busyPlan !== null}
                    onClick={() => void choose(p)}
                  >
                    {busyPlan === p.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : !isCurrent && buyable ? (
                      <Sparkles className="size-4" />
                    ) : null}
                    {isCurrent
                      ? t("currentPlanBtn")
                      : buyable
                        ? t("choose", { plan: p.name })
                        : t("notAvailableOnline")}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );

  function statusLabel(): string {
    if (block === "suspended") return t("statusSuspended");
    if (block === "trial_ended") return t("statusTrialEnded");
    if (block === "expired") return t("statusExpired");
    switch (billing?.status) {
      case "trialing":
        return t("statusTrial", { days: trialDaysLeft });
      case "active":
        return t("statusActive");
      case "past_due":
        return t("statusPastDue");
      case "cancelled":
        return t("statusCancelled");
      default:
        return "—";
    }
  }

  function statusLine(): string {
    if (!billing) return "";
    if (block === "trial_ended" || block === "expired") return t("lineChoosePlan");
    switch (billing.status) {
      case "trialing":
        return t("lineTrial", { date: date(billing.trial_ends_at) });
      case "active":
        return t("lineRenews", {
          date: date(billing.current_period_end),
          cycle: billing.billing_cycle === "yearly" ? t("yearly") : t("monthly"),
        });
      case "past_due":
        return t("linePastDue");
      case "cancelled":
        return t("lineEnds", { date: date(billing.current_period_end) });
      default:
        return "";
    }
  }
}

function StatusBadge({
  status,
  block,
  label,
}: {
  status: string | undefined;
  block: string | null;
  label: string;
}) {
  const tone = block
    ? "bg-destructive/15 text-destructive"
    : status === "active"
      ? "bg-primary/15 text-primary"
      : status === "past_due" || status === "cancelled"
        ? "bg-amber-500/15 text-amber-500"
        : "bg-muted text-muted-foreground";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{label}</span>;
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const t = useTranslations("Settings.billing");
  const format = useFormatter();
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {limit === null
            ? t("usedUnlimited", { used: format.number(used) })
            : t("usedOf", { used: format.number(used), limit: format.number(limit) })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            limit === null ? "w-0" : pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary",
          )}
          style={limit === null ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
