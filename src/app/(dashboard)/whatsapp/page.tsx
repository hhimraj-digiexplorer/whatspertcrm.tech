"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleX,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useEmbeddedSignup } from "@/components/whatsapp/use-embedded-signup";
import { WhatsAppConfig } from "@/components/settings/whatsapp-config";
import { cn } from "@/lib/utils";

interface NumberHealth {
  id: string;
  display_phone_number: string;
  verified_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  status: string | null;
  name_status: string | null;
}

interface NumbersResponse {
  connected: boolean;
  status?: string;
  waba_id?: string | null;
  phone_number_id?: string;
  onboarding_method?: string;
  registered?: boolean;
  business_name?: string | null;
  numbers?: NumberHealth[];
  last_sync?: string;
  error?: string;
}

/**
 * Setup WhatsApp: connect a number (one-click Embedded Signup or your
 * own Cloud API credentials) and see the health of the connected
 * WhatsApp Business Account.
 */
export default function WhatsAppSetupPage() {
  const t = useTranslations("WhatsAppSetup");
  const format = useFormatter();
  const { canEditSettings } = useAuth();
  const { configured, busy, start } = useEmbeddedSignup();
  const [data, setData] = useState<NumbersResponse | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showOptions, setShowOptions] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/whatsapp/numbers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((b: NumbersResponse) => alive && setData(b))
      .catch(() => alive && setData({ connected: false }));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const reload = useCallback(() => {
    setData(null);
    setReloadKey((k) => k + 1);
  }, []);

  async function runSignup(coexistence: boolean) {
    const result = await start({ coexistence });
    if (result.kind === "connected") {
      if (result.registrationError) toast.warning(t("connectedRegisterFailed", { error: result.registrationError }));
      else toast.success(t("connected"));
      setShowOptions(false);
      reload();
    } else if (result.kind === "failed") {
      toast.error(result.message === "not_configured" ? t("notConfigured") : result.message || t("signupFailed"));
    }
  }

  const connected = data?.connected === true;
  const numbers = data?.numbers ?? [];
  const needsAttention = numbers.filter(
    (n) => (n.status && n.status !== "CONNECTED") || n.quality_rating === "RED",
  ).length;
  const optionsOpen = !connected || showOptions;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <nav className="text-sm text-muted-foreground" aria-label={t("breadcrumb")}>
          <span className="text-primary">{t("connectAccount")}</span> <span aria-hidden>/</span>{" "}
          <span className="text-foreground">WhatsApp</span>
        </nav>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-foreground">
          <MessageCircle className="size-6 text-emerald-500" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_3px_rgb(16_24_40/0.05)] sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
        <Stat icon={Building2} tone="bg-emerald-500/12 text-emerald-500" label={t("statAccounts")} value={data ? (data.waba_id ? 1 : connected ? 1 : 0) : null} />
        <Stat icon={Phone} tone="bg-indigo-500/12 text-indigo-500" label={t("statNumbers")} value={data ? (connected ? Math.max(numbers.length, 1) : 0) : null} />
        <Stat icon={AlertTriangle} tone="bg-amber-500/14 text-amber-500" label={t("statAttention")} value={data ? needsAttention : null} />
        <Stat icon={CircleX} tone="bg-rose-500/12 text-rose-500" label={t("statDisconnected")} value={data ? (connected && data.status !== "connected" ? 1 : 0) : null} />
      </div>

      {/* Connect another */}
      {connected && canEditSettings && (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_3px_rgb(16_24_40/0.05)] sm:flex-row sm:items-center">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500">
            <Plus className="size-6" />
          </span>
          <div className="flex-1">
            <p className="text-[15px] text-foreground">{t("anotherTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("anotherDesc")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowOptions(true);
              requestAnimationFrame(() => optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover"
          >
            <Plus className="size-4" /> {t("connectNew")}
          </button>
        </div>
      )}

      {/* Onboarding options */}
      {optionsOpen && canEditSettings && (
        <section ref={optionsRef} className="scroll-mt-4 rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]">
          <div className="flex items-start justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t("optionsTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("optionsDesc")}</p>
            </div>
            {connected && (
              <button type="button" onClick={() => setShowOptions(false)} aria-label={t("collapse")} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground">
                <ChevronUp className="size-4" />
              </button>
            )}
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            {/* Embedded signup */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-border">
              <div className="border-b-2 border-emerald-500/30 bg-emerald-500/8 px-6 py-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold text-foreground">{t("esTitle")}</h3>
                  <span className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">{t("recommended")}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t("esDesc")}</p>
              </div>
              <div className="flex flex-1 items-center gap-6 px-6 py-8">
                <ul className="flex-1 space-y-2.5 text-[15px] text-foreground">
                  {["esPoint1", "esPoint2", "esPoint3", "esPoint4"].map((k) => (
                    <li key={k} className="flex items-center gap-2.5">
                      <Check className="size-4 shrink-0 text-emerald-500" /> {t(k)}
                    </li>
                  ))}
                </ul>
                <EmbeddedArt />
              </div>
              <div className="grid gap-3 px-6 pb-6 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runSignup(false)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("esNewNumber")} <ArrowRight className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runSignup(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:opacity-60"
                >
                  {t("esBusinessApp")}
                </button>
              </div>
              {!configured && <p className="px-6 pb-5 text-xs text-muted-foreground">{t("notConfiguredHint")}</p>}
            </div>

            {/* Own API */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-border">
              <div className="border-b-2 border-indigo-500/40 bg-indigo-500/8 px-6 py-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold text-foreground">{t("apiTitle")}</h3>
                  <span className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white">{t("alternative")}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t("apiDesc")}</p>
              </div>
              <div className="flex flex-1 items-center gap-6 px-6 py-8">
                <ul className="flex-1 space-y-2.5 text-[15px] text-foreground">
                  {["apiPoint1", "apiPoint2", "apiPoint3", "apiPoint4"].map((k) => (
                    <li key={k} className="flex items-center gap-2.5">
                      <Check className="size-4 shrink-0 text-indigo-500" /> {t(k)}
                    </li>
                  ))}
                </ul>
                <ApiArt />
              </div>
              <div className="px-6 pb-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowManual(true);
                    requestAnimationFrame(() => manualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                >
                  {t("apiConnect")} <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Connected account */}
      {data === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("loading")}
        </div>
      ) : connected ? (
        <section className="rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]">
          <div className="flex flex-col gap-3 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{data.business_name || t("businessAccount")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("wabaId")}: {data.waba_id ?? "—"} · {t(`method_${data.onboarding_method ?? "manual"}`)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={reload} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                <RefreshCw className="size-4" /> {t("refresh")}
              </button>
              <a
                href={data.waba_id ? `https://business.facebook.com/wa/manage/home/?waba_id=${data.waba_id}` : "https://business.facebook.com/wa/manage/home/"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
              >
                <ExternalLink className="size-4" /> {t("manageAccount")}
              </a>
            </div>
          </div>

          {data.error && (
            <p className="mx-6 mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
              {data.error === "token_corrupted" ? t("tokenCorrupted") : t("metaError", { error: data.error })}
            </p>
          )}

          <div className="p-5">
            <div className="overflow-x-auto rounded-xl border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-card-2 px-5 py-3 text-[15px] font-medium text-foreground">
                {t("phoneNumbers")}
                <span className="rounded-md border border-border px-2 text-xs">{numbers.length}</span>
              </div>
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-muted-foreground uppercase">
                    <th className="px-5 py-3 font-medium">{t("colNumber")}</th>
                    <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                    <th className="px-5 py-3 font-medium">{t("colQuality")}</th>
                    <th className="px-5 py-3 font-medium">{t("colLimit")}</th>
                    <th className="px-5 py-3 font-medium">{t("colLastSync")}</th>
                    <th className="px-5 py-3 font-medium">{t("colInUse")}</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.length === 0 ? (
                    <tr className="border-t border-border">
                      <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">{t("noNumbers")}</td>
                    </tr>
                  ) : (
                    numbers.map((n) => {
                      const ok = !n.status || n.status === "CONNECTED";
                      return (
                        <tr key={n.id} className="border-t border-border">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <span className="flex size-10 items-center justify-center rounded-full bg-emerald-500 text-white">
                                <MessageCircle className="size-5" />
                              </span>
                              <div>
                                <p className="font-semibold text-foreground">{n.display_phone_number}</p>
                                <p className="text-xs text-muted-foreground">{n.verified_name ?? "—"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span className="flex items-center gap-1.5 font-medium text-foreground">
                              <span className={cn("size-2 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
                              {n.status ? humanise(n.status) : t("unknown")}
                            </span>
                            {n.name_status && <span className="text-xs text-muted-foreground">{t("name")}: {humanise(n.name_status)}</span>}
                          </td>
                          <td className="px-5 py-4">
                            <span className="flex items-center gap-1.5 font-medium text-foreground">
                              <span className={cn("size-2 rounded-full", qualityDot(n.quality_rating))} />
                              {n.quality_rating ? humanise(n.quality_rating) : t("unknown")}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-medium text-foreground">{n.messaging_limit_tier ?? "—"}</td>
                          <td className="px-5 py-4 text-foreground">
                            {data.last_sync ? format.dateTime(new Date(data.last_sync), { dateStyle: "medium", timeStyle: "short" }) : "—"}
                          </td>
                          <td className="px-5 py-4">
                            {n.id === data.phone_number_id ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                                <ShieldCheck className="size-3.5" /> {t("inUse")}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!data.registered && (
              <p className="mt-3 text-sm text-amber-600">{t("notRegistered")}</p>
            )}
          </div>
        </section>
      ) : !canEditSettings ? (
        <p className="text-sm text-muted-foreground">{t("askAdmin")}</p>
      ) : null}

      {/* Manual credentials (existing form) */}
      {canEditSettings && (
        <section ref={manualRef} className="scroll-mt-4">
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-6 py-4 text-left shadow-[0_1px_3px_rgb(16_24_40/0.05)]"
            aria-expanded={showManual}
          >
            <span className="flex items-center gap-3">
              <KeyRound className="size-5 text-indigo-500" />
              <span>
                <span className="block font-semibold text-foreground">{t("manualTitle")}</span>
                <span className="block text-sm text-muted-foreground">{t("manualDesc")}</span>
              </span>
            </span>
            {showManual ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {showManual && (
            <div className="mt-4">
              <WhatsAppConfig />
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        {t("helpPrefix")}{" "}
        <Link href="/settings?tab=templates" className="text-primary hover:underline">{t("helpTemplates")}</Link>
      </p>
    </div>
  );
}

function humanise(v: string): string {
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
}

function qualityDot(q: string | null): string {
  if (q === "GREEN") return "bg-emerald-500";
  if (q === "YELLOW") return "bg-amber-500";
  if (q === "RED") return "bg-rose-500";
  return "bg-slate-400";
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Phone;
  tone: string;
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex items-center gap-4 lg:px-5 lg:first:pl-0">
      <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl", tone)}>
        <Icon className="size-6" />
      </span>
      <div>
        <p className="text-[15px] text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold text-foreground">{value ?? "—"}</p>
      </div>
    </div>
  );
}

/** Small illustration for the one-click card. */
function EmbeddedArt() {
  return (
    <div className="hidden w-36 shrink-0 flex-col items-center sm:flex" aria-hidden>
      <span className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 ring-8 ring-emerald-500/8">
        <MessageCircle className="size-8 text-emerald-500" />
      </span>
      <span className="h-6 w-px bg-emerald-500/30" />
      <div className="w-full space-y-2 rounded-xl border border-border bg-card-2 p-3">
        <div className="flex items-center gap-2">
          <span className="size-6 rounded-md bg-emerald-500/20" />
          <span className="h-2 flex-1 rounded bg-muted-foreground/20" />
        </div>
        <span className="block h-2 w-3/4 rounded bg-muted-foreground/15" />
        <div className="flex justify-center rounded-lg bg-emerald-500/10 py-2">
          <Check className="size-5 rounded-full bg-emerald-500 p-0.5 text-white" />
        </div>
      </div>
    </div>
  );
}

/** Small illustration for the own-API card. */
function ApiArt() {
  return (
    <div className="hidden w-36 shrink-0 sm:block" aria-hidden>
      <div className="rounded-xl border border-indigo-500/30 bg-card-2 p-3 shadow-sm">
        <div className="mb-2 flex gap-1">
          <span className="size-1.5 rounded-full bg-indigo-500" />
          <span className="size-1.5 rounded-full bg-indigo-500" />
          <span className="size-1.5 rounded-full bg-indigo-500" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <span className="size-3 rounded bg-indigo-500/40" />
            <span className="h-1.5 flex-1 rounded bg-muted-foreground/20" />
          </div>
        ))}
        <div className="mt-2 flex items-center justify-end gap-1 text-[10px] font-semibold text-indigo-500">
          <KeyRound className="size-3" /> API
        </div>
      </div>
    </div>
  );
}
