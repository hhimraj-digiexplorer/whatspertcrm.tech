"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Blocks, Building, Check, Code2, Lock } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  RealExpertPanel,
  type RealExpertIntegration,
} from "@/components/integrations/real-expert-panel";
import { cn } from "@/lib/utils";

/**
 * Integrations: connect Whatspert CRM to other tools. The headline
 * integration is DigiExplorer's Real Expert CRM; the public REST API
 * and webhooks cover everything else.
 */
export default function IntegrationsPage() {
  const t = useTranslations("Integrations");
  const { canEditSettings } = useAuth();
  const [integration, setIntegration] = useState<RealExpertIntegration | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canEditSettings) return;
    let alive = true;
    fetch("/api/integrations/real-expert", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { integration: null }))
      .then((b: { integration: RealExpertIntegration | null }) => alive && setIntegration(b.integration))
      .catch(() => alive && setIntegration(null));
    return () => {
      alive = false;
    };
  }, [canEditSettings]);

  const connected = !!integration;
  const showPanel = canEditSettings && (open || connected);

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
              <StatusPill state={integration === undefined ? "loading" : connected ? (integration.is_active ? "on" : "paused") : "off"} />
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
          <div className="px-6 pb-6">
            {canEditSettings ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                {connected ? t("manage") : t("connect")} <ArrowRight className="size-4" />
              </button>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="size-4" /> {t("adminOnly")}
              </p>
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

      {showPanel && integration !== undefined && (
        <div ref={panelRef} className="scroll-mt-4">
          <RealExpertPanel
            integration={integration}
            onChange={(next) => {
              setIntegration(next);
              if (!next) setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: "loading" | "on" | "paused" | "off" }) {
  const t = useTranslations("Integrations");
  if (state === "loading") return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
        state === "on" && "bg-emerald-600 text-white",
        state === "paused" && "bg-amber-500 text-white",
        state === "off" && "bg-muted text-muted-foreground",
      )}
    >
      {state === "on" ? t("statusOn") : state === "paused" ? t("statusPaused") : t("statusOff")}
    </span>
  );
}
