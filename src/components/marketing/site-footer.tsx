import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/signup", label: "Start free trial" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/contact", label: "Contact us" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/refund-policy", label: "Refund & cancellation" },
      { href: "/shipping-policy", label: "Service delivery" },
      { href: "/data-deletion", label: "Data deletion" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-400">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Link href="/" className="flex items-center gap-2">
            <LogoMark className="h-9 w-9 rounded-xl" />
            <span className="text-lg font-bold text-white">{BRAND_NAME}</span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed">
            The WhatsApp CRM for Indian businesses — shared inbox, broadcasts, automations and
            sales pipelines on the official WhatsApp Business API.
          </p>
          <p className="mt-4 text-sm">
            <a href={`mailto:${COMPANY.supportEmail}`} className="hover:text-white">
              {COMPANY.supportEmail}
            </a>
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-sm font-semibold text-white">{col.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs sm:px-6 md:flex-row md:justify-between">
          <p>
            © {year} {COMPANY.legalName}, {COMPANY.city}. All rights reserved.
          </p>
          <p>WhatsApp is a trademark of Meta Platforms, Inc. {BRAND_NAME} is not affiliated with Meta.</p>
        </div>
      </div>
    </footer>
  );
}
