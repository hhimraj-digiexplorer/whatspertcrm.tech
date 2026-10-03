import {
  Bell,
  Blocks,
  Bot,
  GitBranch,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  PlugZap,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  /** Key in the `Sidebar` message namespace. */
  labelKey: string;
  icon: LucideIcon;
  /** Tinted icon tile — background + icon colour, legible in both modes. */
  tone: string;
  /** Small "Beta" chip after the label. Informational only. */
  beta?: boolean;
}

/** Main navigation, in sidebar order. Also feeds the header's menu search. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, tone: "bg-orange-500/12 text-orange-500" },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare, tone: "bg-violet-500/12 text-violet-500" },
  { href: "/whatsapp", labelKey: "whatsappSetup", icon: PlugZap, tone: "bg-emerald-500/12 text-emerald-500" },
  { href: "/contacts", labelKey: "contacts", icon: Users, tone: "bg-green-500/12 text-green-500" },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Megaphone, tone: "bg-amber-500/14 text-amber-500" },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch, tone: "bg-sky-500/12 text-sky-500" },
  { href: "/automations", labelKey: "automations", icon: Zap, tone: "bg-yellow-500/15 text-yellow-500" },
  { href: "/flows", labelKey: "flows", icon: Workflow, tone: "bg-teal-500/12 text-teal-500", beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: Bot, tone: "bg-fuchsia-500/12 text-fuchsia-500" },
  { href: "/integrations", labelKey: "integrations", icon: Blocks, tone: "bg-indigo-500/12 text-indigo-500" },
  { href: "/notifications", labelKey: "notifications", icon: Bell, tone: "bg-rose-500/12 text-rose-500" },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  href: "/settings",
  labelKey: "settings",
  icon: Settings,
  tone: "bg-slate-500/12 text-slate-500",
};

/** Shown only to platform operators (SUPER_ADMIN_EMAILS). */
export const SUPER_ADMIN_NAV_ITEM: NavItem = {
  href: "/admin",
  labelKey: "platformAdmin",
  icon: ShieldCheck,
  tone: "bg-red-500/12 text-red-500",
};

/** Is `href` the current section? (/dashboard only matches exactly.) */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}
