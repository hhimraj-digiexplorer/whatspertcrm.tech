"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock } from "lucide-react";
import { useBilling } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";

/** Trial countdown shows in the last few days only. */
const TRIAL_WARNING_DAYS = 3;

/**
 * Account-wide billing notice above every dashboard page: the trial is
 * about to end, or the account can't send (trial over, subscription
 * lapsed, suspended). Renders nothing while everything is fine.
 */
export function BillingBanner() {
  const t = useTranslations("BillingBanner");
  const { data } = useBilling();
  if (!data) return null;

  const { block, trialDaysLeft, canManage, billing } = data;
  const trialEnding =
    !block && billing?.status === "trialing" && trialDaysLeft <= TRIAL_WARNING_DAYS;
  if (!block && !trialEnding) return null;

  const message = block
    ? t(block === "suspended" ? "suspended" : block === "trial_ended" ? "trialEnded" : "expired")
    : t("trialEnding", { days: trialDaysLeft });
  const Icon = block ? AlertTriangle : Clock;

  return (
    <div
      role={block ? "alert" : "status"}
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6",
        block
          ? "border-destructive/30 bg-destructive/10 text-foreground"
          : "border-amber-500/30 bg-amber-500/10 text-foreground",
      )}
    >
      <span className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", block ? "text-destructive" : "text-amber-500")} />
        {message}
      </span>
      {block !== "suspended" &&
        (canManage ? (
          <Link
            href="/settings?tab=billing"
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("choosePlan")}
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">{t("askOwner")}</span>
        ))}
    </div>
  );
}
