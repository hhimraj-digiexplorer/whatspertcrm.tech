"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, CircleHelp, ExternalLink, Loader2, Wrench, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckState = "ok" | "warn" | "fail" | "unknown";

interface SetupCheck {
  key: "business_verification" | "account_review" | "payment_method" | "can_send";
  state: CheckState;
  value: string | null;
  details: string[];
  fixUrl: string | null;
}

interface HealthResponse {
  checks: SetupCheck[];
  checks_error: string | null;
  webhook_subscribed: boolean | null;
  number: { status: string | null; platform_type: string | null; code_verification_status: string | null } | null;
  last_inbound_at: string | null;
  error?: string;
}

interface RepairStep {
  key: "subscribe" | "verify_subscription" | "register";
  state: "ok" | "fail" | "skipped" | "needs_pin";
  error?: string;
}

const ICON: Record<CheckState, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: CircleAlert,
  fail: XCircle,
  unknown: CircleHelp,
};
const TONE: Record<CheckState, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  fail: "text-rose-500",
  unknown: "text-muted-foreground",
};

function humanise(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replace(/_/g, " ");
}

/**
 * "Why can't I send / receive?" — Meta's account checks plus the webhook
 * and registration state, with a one-click repair for admins.
 */
export function ConnectionHealth({ canRepair, reloadKey, onRepaired }: { canRepair: boolean; reloadKey: number; onRepaired: () => void }) {
  const t = useTranslations("WhatsAppSetup");
  const format = useFormatter();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [steps, setSteps] = useState<RepairStep[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/health", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as HealthResponse;
      setData(res.ok ? body : { ...body, checks: [], checks_error: body.error ?? null, webhook_subscribed: null, number: null, last_inbound_at: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function repair() {
    setRepairing(true);
    setSteps(null);
    try {
      const res = await fetch("/api/whatsapp/health", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; steps?: RepairStep[]; error?: string };
      if (!res.ok) {
        toast.error(body.error ?? t("repairFailed"));
        return;
      }
      setSteps(body.steps ?? []);
      if (body.ok) toast.success(t("repairDone"));
      else toast.warning(t("repairPartial"));
      onRepaired();
      await load();
    } finally {
      setRepairing(false);
    }
  }

  const numberState: CheckState | null = data?.number
    ? data.number.platform_type === "CLOUD_API" && (!data.number.status || data.number.status === "CONNECTED")
      ? "ok"
      : "fail"
    : null;
  const webhookState: CheckState =
    data?.webhook_subscribed == null ? "unknown" : data.webhook_subscribed ? "ok" : "fail";

  return (
    <section className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]">
      <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("healthTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("healthDesc")}</p>
        </div>
        {canRepair && (
          <button
            type="button"
            onClick={() => void repair()}
            disabled={repairing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover disabled:opacity-60"
          >
            {repairing ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />} {t("fixConnection")}
          </button>
        )}
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 px-6 py-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("healthLoading")}
        </div>
      ) : (
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("healthSetup")}</h3>
            {data?.checks_error && <p className="mb-2 text-sm text-amber-600">{data.checks_error}</p>}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {(data?.checks ?? []).map((c) => {
                const Icon = ICON[c.state];
                return (
                  <li key={c.key} className="flex items-start gap-3 px-4 py-3">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[c.state])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {t(`check_${c.key}`)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {c.value ? humanise(c.value) : t("unknown")}
                        </span>
                      </p>
                      {c.state !== "ok" && <p className="text-xs text-muted-foreground">{t(`check_${c.key}_help`)}</p>}
                      {c.details.map((d) => (
                        <p key={d} className="mt-1 text-xs text-foreground">{d}</p>
                      ))}
                    </div>
                    {c.fixUrl && c.state !== "ok" && (
                      <a href={c.fixUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
                        {t("fixInMeta")} <ExternalLink className="size-3" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("healthConnection")}</h3>
            <ul className="divide-y divide-border rounded-xl border border-border">
              <li className="flex items-start gap-3 px-4 py-3">
                {(() => {
                  const Icon = ICON[webhookState];
                  return <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[webhookState])} />;
                })()}
                <div>
                  <p className="text-sm font-medium text-foreground">{t("healthWebhook")}</p>
                  <p className="text-xs text-muted-foreground">
                    {webhookState === "ok" ? t("healthWebhookOk") : webhookState === "fail" ? t("healthWebhookOff") : t("unknown")}
                  </p>
                </div>
              </li>
              {numberState && (
                <li className="flex items-start gap-3 px-4 py-3">
                  {(() => {
                    const Icon = ICON[numberState];
                    return <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[numberState])} />;
                  })()}
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("healthRegistration")}</p>
                    <p className="text-xs text-muted-foreground">
                      {numberState === "ok"
                        ? t("healthRegistrationOk")
                        : t("healthRegistrationOff", { status: humanise(data?.number?.status ?? data?.number?.platform_type ?? "unknown") })}
                    </p>
                  </div>
                </li>
              )}
              <li className="flex items-start gap-3 px-4 py-3">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">{t("healthLastInbound")}</p>
                  <p className="text-xs text-muted-foreground">
                    {data?.last_inbound_at
                      ? format.relativeTime(new Date(data.last_inbound_at))
                      : t("healthNoInbound")}
                  </p>
                </div>
              </li>
            </ul>

            {steps && (
              <ul className="mt-3 space-y-1.5 rounded-xl border border-border bg-card-2 px-4 py-3 text-sm">
                {steps.map((s) => (
                  <li key={s.key} className="flex items-start gap-2">
                    {s.state === "ok" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    ) : s.state === "skipped" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
                    )}
                    <span className="text-foreground">
                      {t(`repair_${s.key}`)}
                      {s.state === "skipped" && <span className="text-muted-foreground"> — {t("repairNotNeeded")}</span>}
                      {s.error && <span className="block text-xs text-muted-foreground">{s.error}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
