import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Faq } from "@/components/marketing/faq";
import { getPublicPlans } from "@/lib/marketing/public-plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple WhatsApp CRM plans in Indian rupees. Start with a 14-day free trial, pay by UPI, card or netbanking, cancel anytime.",
};

export default async function PricingPage() {
  const plans = await getPublicPlans();
  return (
    <>
      <section className="bg-gradient-to-b from-[#e8fbef] to-white">
        <div className="mx-auto max-w-3xl px-4 pt-16 pb-10 text-center sm:px-6">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Plans that grow with you</h1>
          <p className="mt-4 text-lg text-slate-600">
            Every plan includes the shared inbox, broadcasts and automations. Start free for 14 days.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <PricingCards plans={plans} />
      </section>
      <section className="bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-900">Billing questions</h2>
          <div className="mt-10">
            <Faq
              items={[
                {
                  q: "What happens after the free trial?",
                  a: "Your account stays as it is, but sending messages pauses until you choose a plan. Nothing is deleted.",
                },
                {
                  q: "Are Meta's WhatsApp charges included in the price?",
                  a: "No. Meta bills some conversation types (such as marketing messages) directly to your Meta business account at its published rates.",
                },
                {
                  q: "Can I change plans later?",
                  a: "Yes. Upgrade or downgrade from Settings → Billing & plan. A new plan starts right away and your previous subscription is stopped.",
                },
                {
                  q: "How do refunds work?",
                  a: "See our refund & cancellation policy. You can cancel anytime and keep access until the end of the period you paid for.",
                },
                {
                  q: "Do prices include GST?",
                  a: "Prices are shown before GST; applicable GST is added at checkout.",
                },
              ]}
            />
          </div>
        </div>
      </section>
    </>
  );
}
