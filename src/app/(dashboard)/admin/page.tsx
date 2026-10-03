"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, LayoutGrid, Loader2, Package, ShieldAlert } from "lucide-react";

import { useIsSuperAdmin } from "@/hooks/use-super-admin";
import { AdminOverview } from "@/components/admin/admin-overview";
import { AdminAccounts } from "@/components/admin/admin-accounts";
import { AdminPlans } from "@/components/admin/admin-plans";
import { cn } from "@/lib/utils";

// Platform admin (operators listed in SUPER_ADMIN_EMAILS). Every API
// call behind these tabs re-checks that server-side; this guard only
// decides what to render. Operator-facing, so English only.

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "accounts", label: "Client accounts", icon: Building2 },
  { id: "plans", label: "Plans & pricing", icon: Package },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageInner />
    </Suspense>
  );
}

function AdminPageInner() {
  const isSuperAdmin = useIsSuperAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "overview";

  if (isSuperAdmin === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking access…
      </div>
    );
  }
  if (!isSuperAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <ShieldAlert className="mx-auto size-10 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold text-foreground">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is for platform administrators only.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Platform admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every client account on this platform — plans, trials, payments and access.
      </p>

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Admin sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => router.replace(`/admin?tab=${id}`, { scroll: false })}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" && <AdminOverview onOpenAccounts={(status) => router.replace(`/admin?tab=accounts${status ? `&status=${status}` : ""}`)} />}
        {tab === "accounts" && <AdminAccounts initialStatus={params.get("status") ?? ""} />}
        {tab === "plans" && <AdminPlans />}
      </div>
    </div>
  );
}
