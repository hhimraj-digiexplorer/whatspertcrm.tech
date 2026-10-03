"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, LogOut, Menu, Search, Settings as SettingsIcon, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBilling } from "@/hooks/use-billing";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import {
  NAV_ITEMS,
  SETTINGS_NAV_ITEM,
  isNavActive,
  type NavItem,
} from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/** Page title for the mobile bar — the current nav section's label. */
function currentSection(pathname: string): NavItem | undefined {
  return [...NAV_ITEMS, SETTINGS_NAV_ITEM].find((item) => isNavActive(pathname, item.href));
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

/**
 * Green top bar: plan usage rings, menu search, notifications, theme
 * toggle and the account menu.
 */
export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const tSidebar = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const unread = useUnreadNotifications();
  const section = currentSection(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between gap-3 bg-topbar px-3 text-topbar-foreground sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/15 hover:text-white lg:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>
        <h1 className="truncate text-base font-semibold sm:text-lg md:hidden">
          {section ? tSidebar(section.labelKey) : ""}
        </h1>
        <UsageRings />
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <MenuSearch />

        <Link
          href="/notifications"
          aria-label={t("notifications")}
          className="relative flex h-10 w-10 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/15 hover:text-white"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>

        <ModeToggle className="text-white/90 hover:bg-white/15 hover:text-white" />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-white/15 focus:outline-none data-popup-open:bg-white/15"
            aria-label={t("openAccountMenu")}
          >
            <Avatar className="size-10 ring-2 ring-white/70">
              {profile?.avatar_url ? (
                <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? t("defaultAvatar")} />
              ) : null}
              <AvatarFallback className="bg-white text-sm font-semibold text-[#0f8f66]">{initial}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-56 bg-popover text-popover-foreground ring-border"
          >
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.full_name ?? t("defaultUser")}
              </p>
              <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ""}</p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <User className="size-4" />
              {t("menuProfile")}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link
                  href="/settings"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <SettingsIcon className="size-4" />
              {t("menuSettings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <LogOut className="size-4" />
              {t("menuSignOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/** Contacts and broadcast messages against the plan, as two rings. */
function UsageRings() {
  const t = useTranslations("Header");
  const format = useFormatter();
  const { data } = useBilling();
  if (!data) return null;

  const compact = (n: number) => format.number(n, { notation: "compact", maximumFractionDigits: 1 });
  const rings = [
    { label: t("usageContacts"), used: data.usage.contacts, limit: data.plan?.max_contacts ?? null },
    {
      label: t("usageMessages"),
      used: data.usage.broadcastsThisMonth,
      limit: data.plan?.max_broadcast_recipients_per_month ?? null,
    },
  ];

  return (
    <Link href="/settings?tab=billing" className="hidden items-center gap-5 md:flex" aria-label={t("usageTitle")}>
      {rings.map((r) => {
        const pct = r.limit ? Math.min(100, Math.round((r.used / r.limit) * 100)) : 0;
        return (
          <span key={r.label} className="flex items-center gap-2.5">
            <Ring pct={r.limit === null ? null : pct} />
            <span className="leading-tight">
              <span className="block text-[13px] text-white/90">{r.label}</span>
              <span className="block text-[13px] font-semibold tabular-nums">
                {compact(r.used)}/{r.limit === null ? "∞" : compact(r.limit)}
              </span>
            </span>
          </span>
        );
      })}
    </Link>
  );
}

function Ring({ pct }: { pct: number | null }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const shown = pct ?? 0;
  return (
    <span className="relative flex size-11 items-center justify-center rounded-full bg-white">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="#d1fae5" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={shown >= 90 ? "#ef4444" : shown >= 70 ? "#f59e0b" : "#10a877"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * c} ${c}`}
        />
      </svg>
      <span className="relative text-[11px] font-bold text-[#0f8f66]">{pct === null ? "∞" : `${pct}%`}</span>
    </span>
  );
}

/** "Search menus…" — jump to any section by name. */
function MenuSearch() {
  const t = useTranslations("Header");
  const tSidebar = useTranslations("Sidebar");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...NAV_ITEMS, SETTINGS_NAV_ITEM].map((item) => ({ ...item, label: tSidebar(item.labelKey) }));
    return q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;
  }, [query, tSidebar]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(href);
  }

  return (
    <div className="relative hidden lg:block">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && items[active]) {
            go(items[active].href);
          } else if (e.key === "Escape") {
            inputRef.current?.blur();
          }
        }}
        placeholder={t("searchMenus")}
        aria-label={t("searchMenus")}
        role="combobox"
        aria-expanded={open}
        aria-controls="menu-search-results"
        className="h-10 w-64 rounded-lg bg-white pr-3 pl-9 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-white/60"
      />
      {open && (
        <ul
          id="menu-search-results"
          role="listbox"
          className="absolute top-12 right-0 z-50 max-h-80 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("noMenuMatch")}</li>
          ) : (
            items.map((item, i) => (
              <li key={item.href} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item.href)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm",
                    i === active ? "bg-primary/10 text-primary" : "text-foreground",
                  )}
                >
                  <span className={cn("flex size-7 items-center justify-center rounded-md", item.tone)}>
                    <item.icon className="size-4" />
                  </span>
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
