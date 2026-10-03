"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Blocks, Building, Check, Code2, KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { COMPANY } from "@/lib/brand";
import {
  RealExpertPanel,
  type RealExpertIntegration,
} from "@/components/integrations/real-expert-panel";
import { cn } from "@/lib/utils";

type LockReason = "crm_unpaid" | "whatsapp_unpaid" | null;
interface EntitlementInfo {
  entitled: boolean;
  reason: LockReason;
}

/**
 * Integrations: connect Whatspert CRM to other tools. The headline
 * integration is DigiExplorer's Real Expert CRM; the public REST API
 * and webhooks cover everything else.
 */
export default function IntegrationsPage() {
  const t = useTranslations("Integrations");
  const { canEditSettings } = useAuth();
  const [integration, setIntegration] = useState<RealExpertIntegration | null | undefined>(undefined);
  const [unlinked, setUnlinked] = useState<EntitlementInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [linkCode, setLinkCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canEditSettings) return;
    let alive = true;
    fetch("/api/integrations/real-expert", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { integration: null }))
      .then((b: { integration: RealExpertIntegration | null; entitlement?: EntitlementInfo }) => {
        if (!alive) return;
        setIntegration(b.integration);
        setUnlinked(b.entitlement ?? null);
      })
      .catch(() => alive && setIntegration(null));
    return () => {
      alive = false;
    };
  }, [canEditSettings]);

  async function createLinkCode() {
    setCreatingCode(true);
    try {
      const res = await fetch("/api/integrations/real-expert/link-code", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setLinkCode(body);
      else toast.error(body.error ?? t("linkCodeFailed"));
    } finally {
      setCreatingCode(false);
    }
  }

  const connected = !!integration;
  const entitled = integration?.entitlement?.entitled === true;
  const lockReason: LockReason = connected ? (integration.entitlement?.reason ?? null) : null;
  const showPanel = canEditSettings && connected && entitled && (open || connected);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <nav className="text-sm text-muted-foreground" aria-label={t("breadcrumb")}>
          <span className="text-primary">{t("breadcrumbRoot")}</span> <span aria-hidden>/</span>{" "}
          <span className="text-foreground">{t("breadcrumbCrm")}</span>
        </nav>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-foreground">
          <Blocks className="size-6 text-indigo-500" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Real Expert CRM */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]">
          <div className="border-b-2 border-indigo-500/25 bg-indigo-500/8 px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                  <Building className="size-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t("reTitle")}</h2>
                  <p className="text-xs font-medium text-indigo-500">{t("reBy")}</p>
                </div>
              </div>
              <StatusPill
                state={
                  integration === undefined
                    ? "loading"
                    : !connected
                      ? "addon"
                      : !entitled
                        ? "locked"
                        : integration.is_active
                          ? "on"
                          : "paused"
                }
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t("reDesc")}</p>
          </div>
          <ul className="flex-1 space-y-2.5 px-6 py-5 text-[15px] text-foreground">
            {["rePoint1", "rePoint2", "rePoint3", "rePoint4"].map((k) => (
              <li key={k} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> {t(k)}
              </li>
            ))}
          </ul>
          <div className="space-y-3 px-6 pb-6">
            {!canEditSettings ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="size-4" /> {t("adminOnly")}
              </p>
            ) : integration === undefined ? null : !connected ? (
              <>
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/6 p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <Lock className="size-4 text-indigo-500" /> {t("addonTitle")}
                  </p>
                  <p className="mt-1 text-muted-foreground">{t("addonDesc")}</p>
                </div>
                <a
                  href={`mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent("Real Expert CRM + WhatsApp package")}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                >
                  {t("addonCta")} <ArrowRight className="size-4" />
                </a>
                <div className="rounded-xl border border-border p-4 text-sm">
                  <p className="font-medium text-foreground">{t("haveRealExpert")}</p>
                  <p className="mt-1 text-muted-foreground">{t("linkCodeDesc")}</p>
                  {linkCode ? (
                    <p className="mt-3 flex flex-wrap items-center gap-3">
                      <code className="rounded-lg bg-muted px-3 py-2 font-mono text-lg font-bold tracking-widest text-foreground">{linkCode.code}</code>
                      <span className="text-xs text-muted-foreground">{t("linkCodeExpires")}</span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={creatingCode}
                      onClick={() => void createLinkCode()}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
                    >
                      {creatingCode ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} {t("linkCodeCreate")}
                    </button>
                  )}
                </div>
              </>
            ) : !entitled ? (
              <>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <Lock className="size-4 text-amber-500" /> {t("lockedTitle")}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {lockReason === "crm_unpaid" ? t("lockedCrm") : t("lockedWhatsapp")}
                  </p>
                </div>
                {lockReason === "whatsapp_unpaid" && (
                  <Link
                    href="/settings?tab=billing"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                  >
                    {t("choosePlan")} <ArrowRight className="size-4" />
                  </Link>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                {t("manage")} <ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* REST API + webhooks */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]">
          <div className="border-b-2 border-emerald-500/25 bg-emerald-500/8 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <Code2 className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t("apiTitle")}</h2>
                <p className="text-xs font-medium text-emerald-600">{t("apiBy")}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t("apiDesc")}</p>
          </div>
          <ul className="flex-1 space-y-2.5 px-6 py-5 text-[15px] text-foreground">
            {["apiPoint1", "apiPoint2", "apiPoint3"].map((k) => (
              <li key={k} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> {t(k)}
              </li>
            ))}
          </ul>
          <div className="px-6 pb-6">
            <Link
              href="/settings?tab=api"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              {t("apiOpen")} <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>

      {showPanel && integration && (
        <div ref={panelRef} className="scroll-mt-4">
          <RealExpertPanel integration={integration} onChange={(next) => next && setIntegration(next)} />
        </div>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: "loading" | "on" | "paused" | "locked" | "addon" }) {
  const t = useTranslations("Integrations");
  if (state === "loading") return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
        state === "on" && "bg-emerald-600 text-white",
        state === "paused" && "bg-amber-500 text-white",
        state === "locked" && "bg-amber-500 text-white",
        state === "addon" && "bg-indigo-600 text-white",
      )}
    >
      {state === "on"
        ? t("statusOn")
        : state === "paused"
          ? t("statusPaused")
          : state === "locked"
            ? t("statusLocked")
            : t("statusAddon")}
    </span>
  );
}
