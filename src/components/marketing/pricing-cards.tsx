"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { PLAN_FEATURES, yearlyDiscountPct } from "@/lib/billing/features";
import { cn } from "@/lib/utils";

export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  price_monthly_inr: number;
  price_yearly_inr: number;
  features: string[];
  is_trial: boolean;
}

/** Days in the free trial (set in migration 047). */
export const TRIAL_DAYS = 7;

const inr = (n: number) => formatCurrency(n, "INR").replace(/\.00$/, "");

/**
 * Pricing cards: the free trial, then the paid plans. The middle paid
 * plan is "Most popular" and shown dark. Prices exclude 18% GST.
 */
export function PricingCards({ plans }: { plans: PublicPlan[] }) {
  const [yearly, setYearly] = useState(true);
  const paid = plans.filter((p) => !p.is_trial);
  const trial = plans.find((p) => p.is_trial);
  const popularId = paid.length >= 2 ? paid[paid.length >= 3 ? 1 : 0].id : null;
  const maxDiscount = Math.max(0, ...paid.map((p) => yearlyDiscountPct(p.price_monthly_inr, p.price_yearly_inr)));

  if (paid.length === 0) {
    return (
      <p className="text-center text-slate-600">
        Pricing is being updated. <Link href="/contact" className="font-semibold text-[#128C7E] underline">Contact us</Link> for a quote.
      </p>
    );
  }

  const cards = trial ? [trial, ...paid] : paid;

  return (
    <div>
      <div className="mb-12 flex justify-center">
        <div role="radiogroup" aria-label="Billing cycle" className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 text-sm font-semibold">
          {[true, false].map((y) => (
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
              {y ? (
                <>
                  Yearly{maxDiscount > 0 && <span className="ml-1.5 rounded-full bg-[#25D366]/15 px-2 py-0.5 text-xs text-[#0f8f66]">Save {maxDiscount}%</span>}
                </>
              ) : (
                "Monthly"
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("mx-auto grid max-w-6xl items-start gap-6", cards.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {cards.map((p) => {
          const dark = p.id === popularId;
          const discount = yearlyDiscountPct(p.price_monthly_inr, p.price_yearly_inr);
          const perMonth = p.is_trial ? 0 : yearly ? Math.round(p.price_yearly_inr / 12) : p.price_monthly_inr;
          const muted = dark ? "text-slate-300" : "text-slate-500";
          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-7 shadow-sm",
                dark
                  ? "border-[#25D366]/60 bg-slate-950 text-white shadow-xl shadow-[#25D366]/15 ring-4 ring-[#25D366]/15 lg:-mt-3"
                  : "border-slate-200 bg-white text-slate-900",
              )}
            >
              {dark && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#10a877] px-3 py-1 text-xs font-bold text-white">
                  Most popular
                </span>
              )}
              {yearly && discount > 0 && (
                <span
                  className={cn(
                    "absolute top-5 right-5 rounded-md px-2 py-0.5 text-xs font-bold",
                    dark ? "bg-amber-400 text-slate-950" : "bg-[#10a877] text-white",
                  )}
                >
                  {discount}% OFF
                </span>
              )}

              <h3 className="text-lg font-bold">{p.is_trial ? `${TRIAL_DAYS} days free trial` : p.name}</h3>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-5xl font-extrabold tracking-tight">{inr(perMonth)}</span>
                {!p.is_trial && <span className={cn("text-base", muted)}>/mo</span>}
                {!p.is_trial && yearly && discount > 0 && (
                  <span className={cn("ml-1 text-base line-through", muted)}>{inr(p.price_monthly_inr)}</span>
                )}
              </p>
              {p.is_trial ? (
                <>
                  <p className={cn("mt-1 text-sm", muted)}>Validity: {TRIAL_DAYS} days</p>
                  <p className="mt-1 text-xs text-slate-400">No credit card required</p>
                </>
              ) : (
                <>
                  <p className={cn("mt-1 text-sm", muted)}>
                    {yearly ? `Billed ${inr(p.price_yearly_inr)}/year` : "Billed monthly"}
                  </p>
                  <p className={cn("mt-1 text-xs font-semibold", dark ? "text-amber-300" : "text-amber-600")}>+ 18% GST extra</p>
                </>
              )}

              <Link
                href={p.is_trial ? "/signup" : `/signup?plan=${encodeURIComponent(p.id)}`}
                className={cn(
                  "mt-6 inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold transition-colors",
                  dark ? "bg-[#10a877] text-white hover:bg-[#0f9a6d]" : "bg-slate-900 text-white hover:bg-slate-800",
                )}
              >
                Get started <ArrowRight className="size-4" />
              </Link>

              <ul className={cn("mt-7 space-y-3 text-sm", dark ? "text-slate-200" : "text-slate-700")}>
                {[...p.features.filter((f) => !/^every feature/i.test(f)), ...PLAN_FEATURES].map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", dark ? "bg-[#10a877]/25" : "bg-[#10a877]/12")}>
                      <Check className="size-3 text-[#10a877]" strokeWidth={3} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mx-auto mt-8 w-fit rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
        Additional 18% GST on all plans. WhatsApp conversation charges from Meta are billed by Meta separately.
      </p>
    </div>
  );
}
