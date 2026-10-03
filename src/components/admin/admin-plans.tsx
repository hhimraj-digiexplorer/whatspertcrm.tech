"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import type { Plan } from "@/lib/billing/plans";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Editable copy of a plan — numbers as strings so fields can be empty. */
interface Draft {
  id: string;
  isNew: boolean;
  name: string;
  description: string;
  price_monthly_inr: string;
  price_yearly_inr: string;
  razorpay_plan_id_monthly: string;
  razorpay_plan_id_yearly: string;
  max_members: string;
  max_contacts: string;
  max_broadcast_recipients_per_month: string;
  ai_enabled: boolean;
  flows_enabled: boolean;
  api_enabled: boolean;
  is_public: boolean;
  is_trial: boolean;
  sort_order: string;
  features: string;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function toDraft(p: Plan): Draft {
  return {
    id: p.id,
    isNew: false,
    name: p.name,
    description: p.description,
    price_monthly_inr: String(p.price_monthly_inr),
    price_yearly_inr: String(p.price_yearly_inr),
    razorpay_plan_id_monthly: p.razorpay_plan_id_monthly ?? "",
    razorpay_plan_id_yearly: p.razorpay_plan_id_yearly ?? "",
    max_members: str(p.max_members),
    max_contacts: str(p.max_contacts),
    max_broadcast_recipients_per_month: str(p.max_broadcast_recipients_per_month),
    ai_enabled: p.ai_enabled,
    flows_enabled: p.flows_enabled,
    api_enabled: p.api_enabled,
    is_public: p.is_public,
    is_trial: p.is_trial,
    sort_order: String(p.sort_order),
    features: p.features.join("\n"),
  };
}

const EMPTY: Draft = {
  id: "",
  isNew: true,
  name: "",
  description: "",
  price_monthly_inr: "0",
  price_yearly_inr: "0",
  razorpay_plan_id_monthly: "",
  razorpay_plan_id_yearly: "",
  max_members: "",
  max_contacts: "",
  max_broadcast_recipients_per_month: "",
  ai_enabled: true,
  flows_enabled: true,
  api_enabled: true,
  is_public: true,
  is_trial: false,
  sort_order: "50",
  features: "",
};

export function AdminPlans() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => alive && setDrafts((body.plans as Plan[]).map(toDraft)))
      .catch(() => {
        if (!alive) return;
        toast.error("Couldn't load plans");
        setDrafts([]);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  if (!drafts) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl">
          Prices are whole rupees before GST. Leave a limit empty for unlimited. To sell a plan
          online, create matching plans in Razorpay Dashboard → Subscriptions → Plans and paste their
          ids here. Changes apply to every account on the plan immediately.
        </p>
        <Button variant="outline" onClick={() => setDrafts([...drafts, { ...EMPTY }])}>
          <Plus className="size-4" /> New plan
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {drafts.map((d, i) => (
          <PlanEditor
            key={d.isNew ? `new-${i}` : d.id}
            initial={d}
            onSaved={reload}
            onDiscard={d.isNew ? () => setDrafts(drafts.filter((_, j) => j !== i)) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function PlanEditor({
  initial,
  onSaved,
  onDiscard,
}: {
  initial: Draft;
  onSaved: () => void;
  onDiscard?: () => void;
}) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...d,
          features: d.features.split("\n"),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Couldn't save the plan");
        return;
      }
      toast.success(`Saved ${d.name}`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof Draft, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${initial.id || "new"}-${key}`}>{label}</Label>
      <Input
        id={`${initial.id || "new"}-${key}`}
        value={d[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        {...props}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-foreground">
          <span>
            {d.name || "New plan"}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {d.isNew ? "" : `(${d.id})`} {d.is_trial ? "· trial plan" : ""} {!d.is_public ? "· hidden" : ""}
            </span>
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatCurrency(Number(d.price_monthly_inr) || 0, "INR")} / month
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {d.isNew && field("id", "Plan id (lowercase, e.g. agency)", { placeholder: "agency" })}
          {field("name", "Name")}
          {field("sort_order", "Display order", { type: "number" })}
        </div>
        {field("description", "Short description")}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("price_monthly_inr", "Monthly price (₹)", { type: "number", min: 0 })}
          {field("price_yearly_inr", "Yearly price (₹)", { type: "number", min: 0 })}
          {field("razorpay_plan_id_monthly", "Razorpay plan id — monthly", { placeholder: "plan_…" })}
          {field("razorpay_plan_id_yearly", "Razorpay plan id — yearly", { placeholder: "plan_…" })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("max_members", "Team members", { type: "number", min: 1, placeholder: "Unlimited" })}
          {field("max_contacts", "Contacts", { type: "number", min: 0, placeholder: "Unlimited" })}
          {field("max_broadcast_recipients_per_month", "Broadcasts / month", { type: "number", min: 0, placeholder: "Unlimited" })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["ai_enabled", "AI assistant"],
              ["api_enabled", "Public API"],
              ["flows_enabled", "Flows"],
              ["is_public", "Show on pricing page"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
              {label}
              <Switch checked={d[key]} onCheckedChange={(v: boolean) => set(key, v)} />
            </label>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${initial.id || "new"}-features`}>Features (one per line, shown on pricing)</Label>
          <textarea
            id={`${initial.id || "new"}-features`}
            value={d.features}
            onChange={(e) => set("features", e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save plan
          </Button>
          {onDiscard && (
            <Button variant="ghost" onClick={onDiscard}>
              Discard
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
