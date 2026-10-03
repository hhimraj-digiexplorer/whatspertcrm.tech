"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  price_monthly_inr: number;
  price_yearly_inr: number;
  features: string[];
}

/** The plan marked "Most popular" — the middle one when there are three. */
function popularIndex(n: number): number {
  return n >= 3 ? Math.floor(n / 2) : -1;
}

export function PricingCards({ plans }: { plans: PublicPlan[] }) {
  const [yearly, setYearly] = useState(false);
  const popular = popularIndex(plans.length);

  if (plans.length === 0) {
    return (
      <p className="text-center text-slate-600">
        Pricing is being updated. <Link href="/contact" className="font-semibold text-[#128C7E] underline">Contact us</Link> for a quote.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-10 flex justify-center">
        <div role="radiogroup" aria-label="Billing cycle" className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 text-sm font-semibold">
          {[false, true].map((y) => (
            <button
              key={String(y)}
              type="button"
              role="radio"
              aria-checked={yearly === y}
              onClick={() => setYearly(y)}
              className={cn(
                "rounded-full px-5 py-2 transition-colors",
                yearly === y ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
              )}
            >
              {y ? "Yearly · 2 months free" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("mx-auto grid max-w-6xl gap-6", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {plans.map((p, i) => {
          const isPopular = i === popular;
          const price = yearly ? p.price_yearly_inr : p.price_monthly_inr;
          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-white p-7 shadow-sm",
                isPopular ? "border-[#25D366] shadow-xl shadow-[#25D366]/10 ring-1 ring-[#25D366]" : "border-slate-200",
              )}
            >
              {isPopular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#25D366] px-3 py-1 text-xs font-bold text-slate-950">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-slate-600">{p.description}</p>
              <p className="mt-6">
                <span className="text-4xl font-extrabold tracking-tight text-slate-900">{formatCurrency(price, "INR")}</span>
                <span className="ml-1 text-sm text-slate-500">{yearly ? "/ year" : "/ month"}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {yearly && p.price_monthly_inr > 0
                  ? `${formatCurrency(Math.round(p.price_yearly_inr / 12), "INR")}/month billed yearly · `
                  : ""}
                + GST
              </p>
              <Link
                href={`/signup?plan=${encodeURIComponent(p.id)}`}
                className={cn(
                  "mt-6 rounded-lg px-4 py-3 text-center text-sm font-bold transition-colors",
                  isPopular ? "bg-[#25D366] text-slate-950 hover:bg-[#1ebe5b]" : "bg-slate-900 text-white hover:bg-slate-800",
                )}
              >
                Start 14-day free trial
              </Link>
              <ul className="mt-7 space-y-3 text-sm text-slate-700">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-[#128C7E]" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm text-slate-500">
        Every plan starts with a 14-day free trial — no card needed. WhatsApp conversation charges
        from Meta are billed by Meta separately.
      </p>
    </div>
  );
}
