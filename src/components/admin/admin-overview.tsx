"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Overview {
  totalAccounts: number;
  newAccounts30d: number;
  messages30d: number;
  mrr: number;
  arr: number;
  byStatus: Record<string, number>;
  byPlan: Record<string, { name: string; accounts: number; mrr: number }>;
}

const STATUS_TILES: { id: string; label: string; hint: string }[] = [
  { id: "trialing", label: "On trial", hint: "Free trial running" },
  { id: "active", label: "Paying", hint: "Active subscription" },
  { id: "past_due", label: "Payment failed", hint: "Renewal being retried" },
  { id: "cancelled", label: "Cancelled", hint: "Won't renew" },
  { id: "expired", label: "Expired", hint: "Trial or plan ended" },
  { id: "suspended", label: "Suspended", hint: "Blocked by you" },
];

export function AdminOverview({ onOpenAccounts }: { onOpenAccounts: (status?: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load the overview.</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(n);
  const plans = Object.entries(data.byPlan).sort((a, b) => b[1].mrr - a[1].mrr || b[1].accounts - a[1].accounts);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={formatCurrency(data.mrr, "INR")} hint={`${formatCurrency(data.arr, "INR")} a year`} />
        <Stat label="Client accounts" value={fmt(data.totalAccounts)} hint={`${fmt(data.newAccounts30d)} new in 30 days`} />
        <Stat label="Paying accounts" value={fmt(data.byStatus.active ?? 0)} hint={`${fmt(data.byStatus.trialing ?? 0)} on trial`} />
        <Stat label="Messages, last 30 days" value={fmt(data.messages30d)} hint="Across all accounts" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Accounts by status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {STATUS_TILES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenAccounts(s.id)}
              className="rounded-lg border border-border bg-card-2 p-3 text-left transition-colors hover:border-primary/50"
            >
              <div className="text-2xl font-semibold tabular-nums text-foreground">{fmt(data.byStatus[s.id] ?? 0)}</div>
              <div className="mt-1 text-sm font-medium text-foreground">{s.label}</div>
              <div className="text-xs text-muted-foreground">{s.hint}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Revenue by plan</CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 text-right font-medium">Accounts</th>
                  <th className="py-2 text-right font-medium">MRR</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(([id, p]) => (
                  <tr key={id} className="border-t border-border">
                    <td className="py-2 text-foreground">{p.name}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">{fmt(p.accounts)}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">{formatCurrency(p.mrr, "INR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
