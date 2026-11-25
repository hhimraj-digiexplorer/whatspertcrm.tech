"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Building2,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useCan } from "@/hooks/use-can";
import { PROJECT_CATEGORIES, suggestTag, type Project } from "@/lib/projects/match";
import { SettingsPanelHead } from "./settings-panel-head";

interface LeadSource {
  id: string;
  name: string;
  path: string | null;
  default_project_id: string | null;
  tags: string[];
  send_welcome: boolean;
  welcome_template: string | null;
  welcome_language: string | null;
  default_country_code: string;
  is_active: boolean;
  leads_received: number;
  last_received_at: string | null;
  last_error: string | null;
}

interface TemplateOption {
  name: string;
  language: string | null;
}

type ProjectDraft = {
  id?: string;
  name: string;
  category: Project["category"];
  tag: string;
  tagTouched: boolean;
  code: string;
  keywords: string;
  ad_ids: string;
  welcome: string; // "default" | "none" | "name|lang"
  ai_instructions: string;
  is_active: boolean;
};

type SourceDraft = {
  id?: string;
  name: string;
  default_project_id: string;
  tags: string;
  send_welcome: boolean;
  welcome: string; // "" | "name|lang"
  default_country_code: string;
};

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none";

function projectDraft(p?: Project): ProjectDraft {
  return {
    id: p?.id,
    name: p?.name ?? "",
    category: p?.category ?? "residential",
    tag: p?.tag ?? "",
    tagTouched: !!p,
    code: p?.code ?? "",
    keywords: (p?.keywords ?? []).join(", "),
    ad_ids: (p?.ad_ids ?? []).join(", "),
    welcome:
      p?.welcome_mode === "none"
        ? "none"
        : p?.welcome_mode === "template" && p.welcome_template
          ? `${p.welcome_template}|${p.welcome_language ?? ""}`
          : "default",
    ai_instructions: p?.ai_instructions ?? "",
    is_active: p?.is_active ?? true,
  };
}

function sourceDraft(s?: LeadSource): SourceDraft {
  return {
    id: s?.id,
    name: s?.name ?? "",
    default_project_id: s?.default_project_id ?? "",
    tags: (s?.tags ?? []).join(", "),
    send_welcome: s?.send_welcome ?? true,
    welcome: s?.welcome_template ? `${s.welcome_template}|${s.welcome_language ?? ""}` : "",
    default_country_code: s?.default_country_code ?? "91",
  };
}

const splitList = (v: string) =>
  v
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Settings → Projects: the workspace's projects (one tag each, in the
 * "Project" tag group) and its lead sources — private webhook URLs any
 * CRM, website or automation tool can post leads to.
 */
export function ProjectsPanel() {
  const t = useTranslations("Settings.projects");
  const canEdit = useCan("edit-settings");
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pDraft, setPDraft] = useState<ProjectDraft | null>(null);
  const [sDraft, setSDraft] = useState<SourceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        canEdit ? fetch("/api/lead-webhooks", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const pData = await pRes.json().catch(() => ({}));
      if (pRes.ok) setProjects((pData.projects as Project[]) ?? []);
      if (sRes) {
        const sData = await sRes.json().catch(() => ({}));
        if (sRes.ok) setSources((sData.lead_sources as LeadSource[]) ?? []);
      }
      const { data: tpl } = await createClient()
        .from("message_templates")
        .select("name, language, status")
        .eq("status", "APPROVED")
        .order("name");
      setTemplates(((tpl ?? []) as TemplateOption[]).map((x) => ({ name: x.name, language: x.language })));
    } finally {
      setLoading(false);
    }
  }, [canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(id);
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  async function saveProject() {
    if (!pDraft) return;
    const [tplName, tplLang] = pDraft.welcome.split("|");
    const body = {
      name: pDraft.name,
      category: pDraft.category,
      tag: pDraft.tag || suggestTag(pDraft.name),
      code: pDraft.code || null,
      keywords: splitList(pDraft.keywords),
      ad_ids: splitList(pDraft.ad_ids),
      welcome_mode: pDraft.welcome === "default" || pDraft.welcome === "none" ? pDraft.welcome : "template",
      welcome_template: pDraft.welcome === "default" || pDraft.welcome === "none" ? null : tplName,
      welcome_language: pDraft.welcome === "default" || pDraft.welcome === "none" ? null : tplLang || null,
      ai_instructions: pDraft.ai_instructions || null,
      is_active: pDraft.is_active,
    };
    setSaving(true);
    try {
      const res = await fetch(pDraft.id ? `/api/projects/${pDraft.id}` : "/api/projects", {
        method: pDraft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("projectSaved"));
      setPDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeProject(p: Project) {
    if (!window.confirm(t("deleteProjectConfirm", { name: p.name }))) return;
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("projectDeleted"));
      await load();
    } else toast.error(t("saveFailed"));
  }

  async function saveSource(extra: Record<string, unknown> = {}, target?: LeadSource) {
    const d = target ? sourceDraft(target) : sDraft;
    if (!d) return;
    const [tplName, tplLang] = d.welcome.split("|");
    const body = target
      ? extra
      : {
          name: d.name,
          default_project_id: d.default_project_id || null,
          tags: splitList(d.tags),
          send_welcome: d.send_welcome,
          welcome_template: tplName || null,
          welcome_language: tplName ? tplLang || null : null,
          default_country_code: d.default_country_code,
        };
    setSaving(true);
    try {
      const id = target?.id ?? d.id;
      const res = await fetch(id ? `/api/lead-webhooks/${id}` : "/api/lead-webhooks", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("saveFailed"));
        return;
      }
      toast.success(extra.rotate ? t("urlRotated") : t("sourceSaved"));
      if (!target) setSDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeSource(s: LeadSource) {
    if (!window.confirm(t("deleteSourceConfirm", { name: s.name }))) return;
    const res = await fetch(`/api/lead-webhooks/${s.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("sourceDeleted"));
      await load();
    } else toast.error(t("saveFailed"));
  }

  const templateOptions = templates.map((tp) => (
    <option key={`${tp.name}|${tp.language ?? ""}`} value={`${tp.name}|${tp.language ?? ""}`}>
      {tp.name} ({tp.language ?? "—"})
    </option>
  ));
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? t("noDefaultProject");

  const sample = JSON.stringify(
    {
      name: "Asha Verma",
      phone: "9876543210",
      email: "asha@example.com",
      project: projects[0]?.code ?? projects[0]?.name ?? "AIS Galleria",
      campaign_name: "Galleria – Lucknow – Nov",
      source: "Website",
    },
    null,
    2,
  );

  return (
    <section className="max-w-4xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
        action={
          canEdit ? (
            <Button size="sm" onClick={() => setPDraft(projectDraft())}>
              <Plus className="size-4" />
              {t("newProject")}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-primary" />
            {t("projectsTitle")}
          </CardTitle>
          <CardDescription>{t("routingHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : projects.length === 0 && !pDraft ? (
            <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
          ) : null}

          {projects.map((p) =>
            pDraft?.id === p.id ? null : (
              <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {p.name}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t(`categories.${p.category}`)}
                    </span>
                    {!p.is_active && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600">{t("paused")}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("tagLabel")}: <span className="font-mono">{p.tag}</span>
                    {p.code ? ` · ${t("codeLabel")}: ${p.code}` : ""}
                    {` · ${t("welcomeLabel")}: `}
                    {p.welcome_mode === "none"
                      ? t("welcomeNone")
                      : p.welcome_mode === "template"
                        ? p.welcome_template
                        : t("welcomeDefault")}
                  </p>
                  {(p.keywords.length > 0 || p.ad_ids.length > 0) && (
                    <p className="text-xs text-muted-foreground">
                      {t("matchesOn")}: {[...p.keywords, ...p.ad_ids.map((a) => `ad ${a}`)].join(", ")}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title={t("edit")} onClick={() => setPDraft(projectDraft(p))}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      title={t("delete")}
                      onClick={() => void removeProject(p)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            ),
          )}

          {pDraft && (
            <div className="space-y-3 rounded-lg border border-primary/40 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  {t("nameLabel")}
                  <Input
                    value={pDraft.name}
                    maxLength={120}
                    onChange={(e) =>
                      setPDraft({ ...pDraft, name: e.target.value, tag: pDraft.tagTouched ? pDraft.tag : suggestTag(e.target.value) })
                    }
                    placeholder="AIS Galleria"
                  />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  {t("categoryLabel")}
                  <select
                    className={selectCls}
                    value={pDraft.category}
                    onChange={(e) => setPDraft({ ...pDraft, category: e.target.value as Project["category"] })}
                  >
                    {PROJECT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`categories.${c}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  {t("tagLabel")}
                  <Input
                    value={pDraft.tag}
                    maxLength={50}
                    onChange={(e) => setPDraft({ ...pDraft, tag: e.target.value, tagTouched: true })}
                    placeholder="p-ais-galleria"
                    className="font-mono"
                  />
                  <span className="block text-[11px]">{t("tagHint")}</span>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  {t("codeLabel")}
                  <Input value={pDraft.code} maxLength={60} onChange={(e) => setPDraft({ ...pDraft, code: e.target.value })} placeholder="GAL-01" />
                  <span className="block text-[11px]">{t("codeHint")}</span>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                  {t("keywordsLabel")}
                  <Input
                    value={pDraft.keywords}
                    onChange={(e) => setPDraft({ ...pDraft, keywords: e.target.value })}
                    placeholder="galleria, ais galleria, gomti nagar villas"
                  />
                  <span className="block text-[11px]">{t("keywordsHint")}</span>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                  {t("adIdsLabel")}
                  <Input
                    value={pDraft.ad_ids}
                    onChange={(e) => setPDraft({ ...pDraft, ad_ids: e.target.value })}
                    placeholder="120211223344556677"
                    className="font-mono"
                  />
                  <span className="block text-[11px]">{t("adIdsHint")}</span>
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  {t("welcomeLabel")}
                  <select className={selectCls} value={pDraft.welcome} onChange={(e) => setPDraft({ ...pDraft, welcome: e.target.value })}>
                    <option value="default">{t("welcomeDefault")}</option>
                    <option value="none">{t("welcomeNone")}</option>
                    {templateOptions}
                    {pDraft.welcome.includes("|") &&
                      !templates.some((tp) => `${tp.name}|${tp.language ?? ""}` === pDraft.welcome) && (
                        <option value={pDraft.welcome}>{pDraft.welcome.replace("|", " (")})</option>
                      )}
                  </select>
                  <span className="block text-[11px]">{t("welcomeHint")}</span>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 text-sm text-foreground">
                  {t("activeLabel")}
                  <Switch checked={pDraft.is_active} onCheckedChange={(v) => setPDraft({ ...pDraft, is_active: v })} />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                  {t("aiLabel")}
                  <Textarea
                    value={pDraft.ai_instructions}
                    maxLength={4000}
                    rows={4}
                    onChange={(e) => setPDraft({ ...pDraft, ai_instructions: e.target.value })}
                    placeholder={t("aiPlaceholder")}
                  />
                  <span className="block text-[11px]">{t("aiHint")}</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPDraft(null)} disabled={saving}>
                  {t("cancel")}
                </Button>
                <Button onClick={() => void saveProject()} disabled={saving || !pDraft.name.trim()}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {t("saveProject")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Webhook className="size-4 text-primary" />
                {t("sourcesTitle")}
              </span>
              <Button variant="outline" size="sm" onClick={() => setSDraft(sourceDraft())}>
                <Plus className="size-4" />
                {t("newSource")}
              </Button>
            </CardTitle>
            <CardDescription>{t("sourcesHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!loading && sources.length === 0 && !sDraft && <p className="text-sm text-muted-foreground">{t("noSources")}</p>}
            {sources.map((s) => {
              const url = s.path ? `${origin}${s.path}` : "";
              return (
                <div key={s.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
                    <div className="flex items-center gap-2">
                      <Switch checked={s.is_active} onCheckedChange={(v) => void saveSource({ is_active: v }, s)} aria-label={t("activeLabel")} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        title={t("rotate")}
                        onClick={() => window.confirm(t("rotateConfirm")) && void saveSource({ rotate: true }, s)}
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        title={t("delete")}
                        onClick={() => void removeSource(s)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {url && (
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{url}</code>
                      <Button variant="outline" size="sm" onClick={() => void copy(url)}>
                        <Copy className="size-3.5" />
                        {t("copy")}
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("defaultProjectLabel")}: {projectName(s.default_project_id)}
                    {s.tags.length > 0 ? ` · ${t("tagsLabel")}: ${s.tags.join(", ")}` : ""}
                    {` · ${t("welcomeLabel")}: `}
                    {s.send_welcome ? (s.welcome_template ?? t("welcomeProjectOnly")) : t("welcomeOff")}
                    {` · ${t("leadsReceived", { count: s.leads_received })}`}
                  </p>
                  {s.last_error && <p className="text-xs text-destructive">{s.last_error}</p>}
                </div>
              );
            })}

            {sDraft && (
              <div className="space-y-3 rounded-lg border border-primary/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    {t("sourceNameLabel")}
                    <Input value={sDraft.name} maxLength={80} onChange={(e) => setSDraft({ ...sDraft, name: e.target.value })} placeholder={t("sourceNamePlaceholder")} />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    {t("defaultProjectLabel")}
                    <select
                      className={selectCls}
                      value={sDraft.default_project_id}
                      onChange={(e) => setSDraft({ ...sDraft, default_project_id: e.target.value })}
                    >
                      <option value="">{t("noDefaultProject")}</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <span className="block text-[11px]">{t("defaultProjectHint")}</span>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    {t("tagsLabel")}
                    <Input value={sDraft.tags} onChange={(e) => setSDraft({ ...sDraft, tags: e.target.value })} placeholder="Website, Meta lead" />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    {t("countryCodeLabel")}
                    <Input
                      value={sDraft.default_country_code}
                      maxLength={3}
                      onChange={(e) => setSDraft({ ...sDraft, default_country_code: e.target.value.replace(/\D/g, "") })}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground">
                    {t("sendWelcomeLabel")}
                    <Switch checked={sDraft.send_welcome} onCheckedChange={(v) => setSDraft({ ...sDraft, send_welcome: v })} />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    {t("sourceWelcomeLabel")}
                    <select
                      className={selectCls}
                      value={sDraft.welcome}
                      disabled={!sDraft.send_welcome}
                      onChange={(e) => setSDraft({ ...sDraft, welcome: e.target.value })}
                    >
                      <option value="">{t("welcomeProjectOnly")}</option>
                      {templateOptions}
                    </select>
                    <span className="block text-[11px]">{t("sourceWelcomeHint")}</span>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setSDraft(null)} disabled={saving}>
                    {t("cancel")}
                  </Button>
                  <Button onClick={() => void saveSource()} disabled={saving || !sDraft.name.trim()}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    {t("createSource")}
                  </Button>
                </div>
              </div>
            )}

            <details className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">{t("howToSend")}</summary>
              <p className="mt-2">{t("howToSendBody")}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-background p-2 font-mono text-[11px] text-foreground">{sample}</pre>
            </details>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
