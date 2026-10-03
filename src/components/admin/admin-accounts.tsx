"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

import { accessBlock, type BillingStatus, type Plan } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AccountRow {
  account_id: string;
  account_name: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  plan_id: string | null;
  plan_name: string | null;
  status: BillingStatus | null;
  billing_cycle: "monthly" | "yearly" | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  admin_notes: string;
  members: number;
  contacts: number;
  messages_30d: number;
}

const STATUS_FILTERS = [
  { id: "", label: "All statuses" },
  { id: "trialing", label: "On trial" },
  { id: "active", label: "Paying" },
  { id: "past_due", label: "Payment failed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "expired", label: "Expired" },
  { id: "suspended", label: "Suspended" },
];

const STATUS_LABEL: Record<BillingStatus, string> = {
  trialing: "Trial",
  active: "Paying",
  past_due: "Payment failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary";

const dateFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function AdminAccounts({ initialStatus }: { initialStatus: string }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<AccountRow | null>(null);

  // Bumped after an edit to refetch the current page.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ q: query, status, page: String(page) });
    fetch(`/api/admin/accounts?${params}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        if (!alive) return;
        setRows(body.accounts);
        setTotal(body.total);
        setPageSize(body.pageSize);
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Couldn't load accounts");
        setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [query, status, page, reloadKey]);

  const reload = () => {
    setRows(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    fetch("/api/admin/plans", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((b) => setPlans(b.plans ?? []));
  }, []);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(q.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by business name or owner email"
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setRows(null);
            setPage(0);
            setStatus(e.target.value);
          }}
          className={cn(selectClass, "sm:w-48")}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Team</th>
              <th className="px-4 py-3 text-right font-medium">Contacts</th>
              <th className="px-4 py-3 text-right font-medium">Msgs 30d</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No accounts match.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.account_id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.account_name}</div>
                    <div className="text-xs text-muted-foreground">{r.owner_email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {r.plan_name ?? r.plan_id ?? "—"}
                    {r.billing_cycle && <span className="ml-1 text-xs text-muted-foreground">({r.billing_cycle})</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusCell row={r} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.members}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.contacts.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.messages_30d.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{dateFmt(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                      Manage
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total.toLocaleString("en-IN")} {total === 1 ? "account" : "accounts"}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => { setRows(null); setPage((p) => p - 1); }} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => { setRows(null); setPage((p) => p + 1); }} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {editing && (
        <ManageAccountDialog
          row={editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function StatusCell({ row }: { row: AccountRow }) {
  const block = row.status
    ? accessBlock({
        status: row.status,
        trial_ends_at: row.trial_ends_at,
        current_period_end: row.current_period_end,
        suspended_at: row.suspended_at,
      })
    : null;
  const label = row.suspended_at
    ? "Suspended"
    : block === "trial_ended"
      ? "Trial ended"
      : row.status
        ? STATUS_LABEL[row.status]
        : "—";
  const tone = row.suspended_at || block
    ? "bg-destructive/15 text-destructive"
    : row.status === "active"
      ? "bg-primary/15 text-primary"
      : row.status === "trialing"
        ? "bg-blue-500/15 text-blue-500"
        : "bg-amber-500/15 text-amber-500";
  const sub =
    row.status === "trialing"
      ? `ends ${dateFmt(row.trial_ends_at)}`
      : row.current_period_end
        ? `${row.status === "active" ? "renews" : "until"} ${dateFmt(row.current_period_end)}`
        : "";
  return (
    <div>
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{label}</span>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ManageAccountDialog({
  row,
  plans,
  onClose,
  onSaved,
}: {
  row: AccountRow;
  plans: Plan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [planId, setPlanId] = useState(row.plan_id ?? "trial");
  const [status, setStatus] = useState<BillingStatus>(row.status ?? "trialing");
  const [cycle, setCycle] = useState(row.billing_cycle ?? "");
  const [periodEnd, setPeriodEnd] = useState(row.current_period_end?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(row.admin_notes);
  const [extendDays, setExtendDays] = useState("7");
  const [suspendReason, setSuspendReason] = useState(row.suspended_reason ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, label: string, success: string) {
    setBusy(label);
    try {
      const res = await fetch(`/api/admin/accounts/${row.account_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Update failed");
        return;
      }
      toast.success(success);
      onSaved();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.account_name}</DialogTitle>
          <DialogDescription>
            {row.owner_name ? `${row.owner_name} · ` : ""}
            {row.owner_email ?? "no owner email"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Plan & subscription</h3>
            <p className="text-xs text-muted-foreground">
              Use this for offline payments or special deals. Online Razorpay subscriptions update
              automatically.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={selectClass}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select value={status} onChange={(e) => setStatus(e.target.value as BillingStatus)} className={selectClass}>
                  {(Object.keys(STATUS_LABEL) as BillingStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Billing cycle</Label>
                <select value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)} className={selectClass}>
                  <option value="">—</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Paid until</Label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void patch(
                  {
                    plan_id: planId,
                    status,
                    billing_cycle: cycle || null,
                    current_period_end: periodEnd ? new Date(`${periodEnd}T23:59:59+05:30`).toISOString() : null,
                  },
                  "plan",
                  "Plan updated",
                )
              }
            >
              {busy === "plan" && <Loader2 className="size-4 animate-spin" />}
              Save plan
            </Button>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Extend trial</h3>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                className="w-24"
                aria-label="Days to add"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void patch({ extend_trial_days: Number(extendDays) }, "trial", `Trial extended by ${extendDays} days`)
                }
              >
                {busy === "trial" && <Loader2 className="size-4 animate-spin" />}
                Add days
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Current trial end: {dateFmt(row.trial_ends_at)}</p>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Access</h3>
            {row.suspended_at ? (
              <>
                <p className="text-sm text-destructive">
                  Suspended {dateFmt(row.suspended_at)}
                  {row.suspended_reason ? ` — ${row.suspended_reason}` : ""}
                </p>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void patch({ suspend: null }, "suspend", "Access restored")}>
                  {busy === "suspend" && <Loader2 className="size-4 animate-spin" />}
                  Restore access
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason shown to the client (optional)"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => void patch({ suspend: { reason: suspendReason } }, "suspend", "Account suspended")}
                >
                  {busy === "suspend" && <Loader2 className="size-4 animate-spin" />}
                  Suspend account
                </Button>
                <p className="text-xs text-muted-foreground">
                  The client can still sign in but can&apos;t send messages until you restore access.
                </p>
              </>
            )}
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <Label htmlFor="admin-notes">Internal notes</Label>
            <textarea
              id="admin-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Deal terms, contact person, GST number…"
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void patch({ admin_notes: notes }, "notes", "Notes saved")}>
              {busy === "notes" && <Loader2 className="size-4 animate-spin" />}
              Save notes
            </Button>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
