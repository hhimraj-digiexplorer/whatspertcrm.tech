"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { BRAND_NAME } from "@/lib/brand";

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label={`${BRAND_NAME} home`}>
          <LogoMark className="h-9 w-9 rounded-xl" />
          <span className="text-lg font-bold tracking-tight text-slate-900">{BRAND_NAME}</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="transition-colors hover:text-slate-900">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-[#1ebe5b]"
          >
            Start free trial
          </Link>
        </div>

        <button
          type="button"
          className="rounded-lg p-2 text-slate-700 lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 pb-5 lg:hidden">
          <nav className="flex flex-col py-2" aria-label="Mobile">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-base font-medium text-slate-700 hover:bg-slate-50"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/login" className="rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-800">
              Log in
            </Link>
            <Link href="/signup" className="rounded-lg bg-[#25D366] px-4 py-2.5 text-center text-sm font-semibold text-slate-950">
              Start free trial
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
