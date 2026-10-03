"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Link2,
  Loader2,
  MessagesSquare,
  PlugZap,
  RefreshCw,
  RotateCw,
  Trash2,
  UserPlus,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_OPTIONS, type RealExpertOptions } from "@/lib/integrations/real-expert/config";
import { cn } from "@/lib/utils";

export interface RealExpertIntegration {
  id: string;
  /** Created and kept up to date by Real Expert CRM (the add-on). */
  partner_managed: boolean;
  partner_crm_plan: string | null;
  entitlement: { entitled: boolean; reason: "crm_unpaid" | "whatsapp_unpaid" | null };
  is_active: boolean;
  base_url: string;
  api_key_hint: string | null;
  sync_new_leads: boolean;
  sync_deals: boolean;
  sync_messages: boolean;
  inbound_enabled: boolean;
  welcome_template_name: string | null;
  welcome_template_language: string | null;
  options: RealExpertOptions;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  inbound_path: string;
  inbound_token: string | null;
  stats: { pending: number; failed: number; synced: number; linked_contacts: number };
}

interface TemplateOption {
  name: string;
  language: string | null;
}

interface Draft {
  is_active: boolean;
  base_url: string;
  api_key: string;
  sync_new_leads: boolean;
  sync_deals: boolean;
  sync_messages: boolean;
  inbound_enabled: boolean;
  welcome_template: string; // "name|language"
  options: RealExpertOptions;
}

function toDraft(i: RealExpertIntegration | null): Draft {
  return {
    is_active: i?.is_active ?? true,
    base_url: i?.base_url ?? "",
    api_key: "",
    sync_new_leads: i?.sync_new_leads ?? true,
    sync_deals: i?.sync_deals ?? true,
    sync_messages: i?.sync_messages ?? false,
    inbound_enabled: i?.inbound_enabled ?? false,
    welcome_template: i?.welcome_template_name
      ? `${i.welcome_template_name}|${i.welcome_template_language ?? ""}`
      : "",
    options: i?.options ?? DEFAULT_OPTIONS,
  };
}

const inputCls =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/40";
const cardCls = "rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgb(16_24_40/0.05)]";

export function RealExpertPanel({
  integration,
  onChange,
}: {
  integration: RealExpertIntegration | null;
  onChange: (next: RealExpertIntegration | null) => void;
}) {
  const t = useTranslations("Integrations.realExpert");
  const format = useFormatter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(integration));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let alive = true;
    createClient()
      .from("message_templates")
      .select("name, language")
      .eq("status", "APPROVED")
      .order("name")
      .then(({ data }) => {
        if (alive) setTemplates((data as TemplateOption[] | null) ?? []);
      });
    // Read after mount: the page is client-only, but the first render
    // must match the server's.
    const id = requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setOpt = <K extends keyof RealExpertOptions>(k: K, v: RealExpertOptions[K]) =>
    setDraft((d) => ({ ...d, options: { ...d.options, [k]: v } }));

  const inboundUrl = integration ? `${origin}${integration.inbound_path}` : "";

  const templateChoices = useMemo(() => {
    const list = templates.map((tp) => ({ value: `${tp.name}|${tp.language ?? ""}`, label: `${tp.name} (${tp.language ?? "—"})` }));
    if (draft.welcome_template && !list.some((o) => o.value === draft.welcome_template)) {
      const [n, l] = draft.welcome_template.split("|");
      list.unshift({ value: draft.welcome_template, label: `${n} (${l || "—"})` });
    }
    return list;
  }, [templates, draft.welcome_template]);

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      const [tplName, tplLang] = draft.welcome_template.split("|");
      const res = await fetch("/api/integrations/real-expert", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_active: draft.is_active,
          base_url: draft.base_url,
          api_key: draft.api_key || undefined,
          sync_new_leads: draft.sync_new_leads,
          sync_deals: draft.sync_deals,
          sync_messages: draft.sync_messages,
          inbound_enabled: draft.inbound_enabled,
          welcome_template_name: tplName || null,
          welcome_template_language: tplLang || null,
          options: draft.options,
          ...extra,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t("saveFailed"));
        return;
      }
      onChange(body.integration);
      setDraft((d) => ({ ...d, api_key: "" }));
      toast.success(extra.rotate_token ? t("tokenRotated") : integration ? t("saved") : t("connected"));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/real-expert/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) toast.success(body.workspace ? t("testOkWorkspace", { name: body.workspace }) : t("testOk"));
      else toast.error(body.message ?? body.error ?? t("testFailed"));
    } finally {
      setTesting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/real-expert/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t("syncFailed"));
        return;
      }
      toast.success(t("syncResult", { done: body.done ?? 0, retrying: (body.retrying ?? 0) + (body.failed ?? 0) }));
      const fresh = await fetch("/api/integrations/real-expert", { cache: "no-store" }).then((r) => r.json());
      onChange(fresh.integration ?? null);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("disconnectConfirm"))) return;
    const res = await fetch("/api/integrations/real-expert", { method: "DELETE" });
    if (res.ok) {
      toast.success(t("disconnected"));
      setDraft(toDraft(null));
      onChange(null);
    } else toast.error(t("saveFailed"));
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => toast.success(t("copied")));
  }

  const when = (iso: string | null) =>
    iso ? format.relativeTime(new Date(iso), new Date()) : t("never");

  return (
    <div className="space-y-5">
      {integration && (
        <section className={cn(cardCls, "p-5")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
            <Stat icon={Link2} tone="bg-indigo-500/12 text-indigo-500" label={t("statLinked")} value={integration.stats.linked_contacts} />
            <Stat icon={CheckCircle2} tone="bg-emerald-500/12 text-emerald-500" label={t("statSynced")} value={integration.stats.synced} />
            <Stat icon={RefreshCw} tone="bg-sky-500/12 text-sky-500" label={t("statPending")} value={integration.stats.pending} />
            <Stat icon={AlertTriangle} tone="bg-rose-500/12 text-rose-500" label={t("statFailed")} value={integration.stats.failed} />
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t("lastSync", { when: when(integration.last_sync_at) })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void test()} disabled={testing} className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60">
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} {t("test")}
              </button>
              <button type="button" onClick={() => void syncNow()} disabled={syncing} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
                {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t("syncNow")}
              </button>
            </div>
          </div>
          {integration.last_error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/8 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
              <div>
                <p className="font-medium text-foreground">{t("lastError", { when: when(integration.last_error_at) })}</p>
                <p className="text-muted-foreground">{integration.last_error}</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Connection */}
      <section className={cardCls}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("connectionTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("connectionDesc")}</p>
          </div>
          {integration && (
            <label className="flex shrink-0 items-center gap-2 text-sm text-foreground">
              <Switch checked={draft.is_active} onCheckedChange={(v: boolean) => set("is_active", v)} />
              {draft.is_active ? t("active") : t("paused")}
            </label>
          )}
        </header>
        {integration?.partner_managed ? (
          <div className="grid gap-4 p-6 text-sm md:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("baseUrl")}</p>
              <p className="mt-0.5 font-medium break-all text-foreground">{integration.base_url}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("crmPlan")}</p>
              <p className="mt-0.5 font-medium text-foreground">{integration.partner_crm_plan ?? "—"}</p>
            </div>
            <p className="text-muted-foreground md:col-span-3">{t("managedByRealExpert")}</p>
          </div>
        ) : (
        <div className="grid gap-4 p-6 md:grid-cols-2">
          <Field label={t("baseUrl")} hint={t("baseUrlHint")}>
            <input className={inputCls} value={draft.base_url} onChange={(e) => set("base_url", e.target.value)} placeholder="https://crm.digiexplorer.in" inputMode="url" autoComplete="off" />
          </Field>
          <Field label={t("apiKey")} hint={integration?.api_key_hint ? t("apiKeyKeep", { hint: integration.api_key_hint }) : t("apiKeyHint")}>
            <input className={inputCls} type="password" value={draft.api_key} onChange={(e) => set("api_key", e.target.value)} placeholder={integration?.api_key_hint ?? ""} autoComplete="new-password" />
          </Field>
        </div>
        )}
      </section>

      {/* Sync options */}
      <section className={cardCls}>
        <header className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{t("syncTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("syncDesc")}</p>
        </header>
        <div className="divide-y divide-border">
          <SyncRow icon={UserPlus} tone="bg-emerald-500/12 text-emerald-500" dir="out" title={t("syncLeadsTitle")} desc={t("syncLeadsDesc")} checked={draft.sync_new_leads} onChange={(v) => set("sync_new_leads", v)} />
          <SyncRow icon={GitBranch} tone="bg-violet-500/12 text-violet-500" dir="out" title={t("syncDealsTitle")} desc={t("syncDealsDesc")} checked={draft.sync_deals} onChange={(v) => set("sync_deals", v)} />
          <SyncRow icon={MessagesSquare} tone="bg-sky-500/12 text-sky-500" dir="out" title={t("syncMessagesTitle")} desc={t("syncMessagesDesc")} checked={draft.sync_messages} onChange={(v) => set("sync_messages", v)} />
          <SyncRow icon={ArrowDownToLine} tone="bg-amber-500/14 text-amber-500" dir="in" title={t("inboundTitle")} desc={t("inboundDesc")} checked={draft.inbound_enabled} onChange={(v) => set("inbound_enabled", v)}>
            {draft.inbound_enabled && (
              <div className="mt-4 space-y-4">
                <Field label={t("welcomeTemplate")} hint={templateChoices.length === 0 ? t("noTemplates") : t.raw("welcomeTemplateHint")}>
                  <select className={inputCls} value={draft.welcome_template} onChange={(e) => set("welcome_template", e.target.value)}>
                    <option value="">{t("chooseTemplate")}</option>
                    {templateChoices.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {integration ? (
                  <div className="space-y-3 rounded-xl bg-muted/60 p-4">
                    <p className="text-sm text-muted-foreground">{t("inboundSetup")}</p>
                    <CopyRow label={t("inboundUrl")} value={inboundUrl} onCopy={copy} />
                    <CopyRow
                      label={t("inboundToken")}
                      value={integration.inbound_token ?? ""}
                      masked={!showToken}
                      onCopy={copy}
                      extra={
                        <>
                          <button type="button" onClick={() => setShowToken((s) => !s)} aria-label={showToken ? t("hide") : t("show")} className="rounded-md p-2 text-muted-foreground hover:bg-card hover:text-foreground">
                            {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                          <button type="button" onClick={() => window.confirm(t("rotateConfirm")) && void save({ rotate_token: true })} aria-label={t("rotate")} title={t("rotate")} className="rounded-md p-2 text-muted-foreground hover:bg-card hover:text-foreground">
                            <RotateCw className="size-4" />
                          </button>
                        </>
                      }
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("inboundAfterSave")}</p>
                )}
              </div>
            )}
          </SyncRow>
        </div>
      </section>

      {/* Advanced */}
      <section className={cardCls}>
        <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="flex w-full items-center justify-between px-6 py-4 text-left">
          <span>
            <span className="block text-lg font-semibold text-foreground">{t("advancedTitle")}</span>
            <span className="block text-sm text-muted-foreground">{t("advancedDesc")}</span>
          </span>
          {showAdvanced ? <ChevronUp className="size-5 text-muted-foreground" /> : <ChevronDown className="size-5 text-muted-foreground" />}
        </button>
        {showAdvanced && (
          <div className="grid gap-4 border-t border-border p-6 md:grid-cols-2">
            <Field label={t("authStyle")}>
              <select className={inputCls} value={draft.options.auth_style} onChange={(e) => setOpt("auth_style", e.target.value as RealExpertOptions["auth_style"])}>
                <option value="bearer">Authorization: Bearer …</option>
                <option value="x-api-key">X-API-Key: …</option>
              </select>
            </Field>
            <Field label={t("countryCode")} hint={t("countryCodeHint")}>
              <input className={inputCls} value={draft.options.default_country_code} onChange={(e) => setOpt("default_country_code", e.target.value)} inputMode="numeric" />
            </Field>
            <Field label={t("leadsPath")}>
              <input className={cn(inputCls, "font-mono")} value={draft.options.leads_path} onChange={(e) => setOpt("leads_path", e.target.value)} />
            </Field>
            <Field label={t("stagePath")}>
              <input className={cn(inputCls, "font-mono")} value={draft.options.stage_path} onChange={(e) => setOpt("stage_path", e.target.value)} />
            </Field>
            <Field label={t("activitiesPath")}>
              <input className={cn(inputCls, "font-mono")} value={draft.options.activities_path} onChange={(e) => setOpt("activities_path", e.target.value)} />
            </Field>
            <Field label={t("testPath")}>
              <input className={cn(inputCls, "font-mono")} value={draft.options.test_path} onChange={(e) => setOpt("test_path", e.target.value)} />
            </Field>
            <Field label={t("leadSource")}>
              <input className={inputCls} value={draft.options.lead_source} onChange={(e) => setOpt("lead_source", e.target.value)} />
            </Field>
          </div>
        )}
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {integration && !integration.partner_managed ? (
          <button type="button" onClick={() => void disconnect()} className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-rose-500 hover:bg-rose-500/10">
            <Trash2 className="size-4" /> {t("disconnect")}
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60">
          {saving && <Loader2 className="size-4 animate-spin" />}
          {integration ? t("save") : t("connectButton")}
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, tone, label, value }: { icon: typeof Link2; tone: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 lg:px-4 lg:first:pl-0">
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-5" />
      </span>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function SyncRow({
  icon: Icon,
  tone,
  dir,
  title,
  desc,
  checked,
  onChange,
  children,
}: {
  icon: typeof Link2;
  tone: string;
  dir: "in" | "out";
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const DirIcon = dir === "in" ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <div className="px-6 py-4">
      <div className="flex items-start gap-4">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-medium text-foreground">
            {title} <DirIcon className="size-3.5 text-muted-foreground" aria-hidden />
          </p>
          <p className="text-sm text-muted-foreground">{desc}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={title} className="data-[unchecked]:bg-slate-300" />
      </div>
      {children && <div className="sm:pl-14">{children}</div>}
    </div>
  );
}

function CopyRow({
  label,
  value,
  masked,
  onCopy,
  extra,
}: {
  label: string;
  value: string;
  masked?: boolean;
  onCopy: (v: string) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card pl-3">
        <code className="min-w-0 flex-1 truncate py-2 font-mono text-xs text-foreground">
          {masked ? "•".repeat(Math.min(value.length, 32)) : value}
        </code>
        {extra}
        <button type="button" onClick={() => onCopy(value)} aria-label={`Copy ${label}`} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
