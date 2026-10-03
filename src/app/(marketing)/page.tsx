import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  GitBranch,
  Inbox,
  Languages,
  Megaphone,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import { HeroMock } from "@/components/marketing/hero-mock";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Faq, type FaqItem } from "@/components/marketing/faq";
import { getPublicPlans } from "@/lib/marketing/public-plans";
import { BRAND_NAME } from "@/lib/brand";

// Signed-in visitors are sent to /dashboard by the middleware, so this
// renders for prospects only. Prices come from the plans table.
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Inbox,
    title: "Shared team inbox",
    body: "Every WhatsApp chat in one place. Assign conversations, add private notes and see who's replying — no more passing one phone around the office.",
  },
  {
    icon: Megaphone,
    title: "Broadcast campaigns",
    body: "Send approved template messages to thousands of customers with their name and details filled in. Track delivered, read and replied for every campaign.",
  },
  {
    icon: Workflow,
    title: "No-code automations",
    body: "Auto-reply to keywords, welcome new leads, tag contacts and assign chats while you sleep. Build button menus and flows by dragging blocks.",
  },
  {
    icon: Sparkles,
    title: "AI reply assistant",
    body: "Draft replies from your own FAQs, prices and policies in one tap — or let the AI answer common questions and hand over to your team when needed.",
  },
  {
    icon: GitBranch,
    title: "Sales pipelines",
    body: "Turn chats into deals and drag them from new lead to won. Know your pipeline value in rupees, lakh and crore at a glance.",
  },
  {
    icon: Users,
    title: "Contacts & segments",
    body: "Import contacts from Excel or CSV, tag and filter them, and add your own fields like city, budget or course.",
  },
  {
    icon: BarChart3,
    title: "Live dashboard",
    body: "Response times, conversation volume, campaign results and pipeline value — updated live for owners and managers.",
  },
  {
    icon: PlugZap,
    title: "API & webhooks",
    body: "Connect your website forms, ad leads and other tools through a REST API and webhooks.",
  },
];

const STEPS = [
  {
    title: "Connect your WhatsApp number",
    body: "Link your number through Meta's official WhatsApp Business API. We guide you step by step — keep the number you already use.",
  },
  {
    title: "Bring in your contacts and templates",
    body: "Import your customer list, create message templates and get them approved by Meta, usually within a day.",
  },
  {
    title: "Reply, broadcast and automate",
    body: "Invite your team, launch your first campaign and switch on automations. Many businesses go live the same day.",
  },
];

const INDUSTRIES = [
  "Real estate",
  "Education & coaching",
  "Clinics & healthcare",
  "Retail & D2C brands",
  "Salons & wellness",
  "Automobile dealers",
  "Travel & tours",
  "Agencies",
];

const FAQ: FaqItem[] = [
  {
    q: "Is this the official WhatsApp Business API?",
    a: `Yes. ${BRAND_NAME} works on Meta's official WhatsApp Business (Cloud) API, so your number stays safe from bans that unofficial tools risk, and you can send campaigns at scale.`,
  },
  {
    q: "Can I use my existing WhatsApp number?",
    a: "Yes, as long as it isn't registered on the regular WhatsApp or WhatsApp Business app at the time of connecting. You can move it over from the app — we'll walk you through it.",
  },
  {
    q: "Do I need a credit card for the free trial?",
    a: "No. Every plan starts with a 14-day free trial with all features. Choose a plan only when you're ready.",
  },
  {
    q: "Are Meta's WhatsApp charges included?",
    a: "No. Meta charges for some conversations (for example marketing messages) directly to your Meta account at their published rates. Our plan price covers the software.",
  },
  {
    q: "How many people can use one number?",
    a: "Your whole team. Several agents can reply from the same WhatsApp number at once, each with their own login and role.",
  },
  {
    q: "Can I pay with UPI?",
    a: "Yes. Pay with UPI, debit or credit card, or netbanking through Razorpay's secure checkout.",
  },
  {
    q: "Is the app available in Hindi?",
    a: "Yes. Each team member can switch the app between English and Hindi (and a few other languages) from Settings.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from Settings → Billing & plan and you keep access until the end of the period you've paid for.",
  },
];

export default async function LandingPage() {
  const plans = await getPublicPlans();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[640px] bg-gradient-to-b from-[#e8fbef] to-white" />
        <div className="mx-auto grid max-w-7xl items-center gap-16 px-4 pt-16 pb-24 sm:px-6 lg:grid-cols-2 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/40 bg-white px-3 py-1 text-xs font-semibold text-[#128C7E] shadow-sm">
              <ShieldCheck className="size-3.5" /> Built on the official WhatsApp Business API
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Sell, support and grow on <span className="text-[#128C7E]">WhatsApp</span> — from one team inbox
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              {BRAND_NAME} brings your WhatsApp chats, campaigns, automations and sales pipeline
              together, so your whole team can reply faster and close more deals.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3.5 text-base font-bold text-slate-950 shadow-lg shadow-[#25D366]/25 transition-colors hover:bg-[#1ebe5b]"
              >
                Start 14-day free trial <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-base font-semibold text-slate-800 transition-colors hover:border-slate-400"
              >
                See pricing
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              {["No credit card needed", "Quick guided setup", "Pay with UPI", "English & हिन्दी"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-[#25D366]" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroMock />
        </div>
      </section>

      {/* Industries */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <p className="text-center text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Made for businesses that sell on WhatsApp
          </p>
          <ul className="mt-6 flex flex-wrap justify-center gap-3">
            {INDUSTRIES.map((i) => (
              <li key={i} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                {i}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="Features"
            title="Everything your team needs to run WhatsApp"
            subtitle="Replace scattered phones, Excel sheets and copy-paste broadcasts with one tool your whole team shares."
          />
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-lg hover:shadow-slate-900/5">
                <div className="flex size-11 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#128C7E]">
                  <f.icon className="size-5" />
                </div>
                <h3 className="mt-5 text-base font-bold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-16 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <Highlight
            icon={Bot}
            title="Answer instantly, even at midnight"
            points={[
              "Keyword auto-replies and welcome messages",
              "Button menus that route customers to the right answer",
              "AI replies grounded in your own FAQs and price list",
              "Smooth handover to a person when the bot can't help",
            ]}
          />
          <Highlight
            icon={Megaphone}
            title="Campaigns that get read"
            points={[
              "Personalised broadcasts with names, dates and offers",
              "Target by tag, custom field or an uploaded list",
              "See delivered, read and replied for every customer",
              "Resume a paused campaign without double-sending",
            ]}
          />
          <Highlight
            icon={Users}
            title="Built for teams"
            points={[
              "Owner, admin, agent and viewer roles",
              "Assign chats and get notified",
              "Private notes and tags on every customer",
              "Each person chooses English or हिन्दी",
            ]}
          />
          <Highlight
            icon={Languages}
            title="Made for India"
            points={[
              "Prices in rupees, amounts in lakh and crore",
              "Pay by UPI, card or netbanking",
              "Local support from our team in Lucknow",
              "Your data stays in your account — never sold",
            ]}
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <SectionHeading eyebrow="How it works" title="Live on WhatsApp in three steps" />
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-slate-200 bg-white p-7">
                <span className="flex size-10 items-center justify-center rounded-full bg-[#075E54] text-base font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-bold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="Pricing"
            title="Simple plans in rupees"
            subtitle="Start free for 14 days. Upgrade, downgrade or cancel anytime."
          />
          <div className="mt-12">
            <PricingCards plans={plans} />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20">
        <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
          <SectionHeading eyebrow="FAQ" title="Questions, answered" />
          <div className="mt-12">
            <Faq items={FAQ} />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-[#075E54] px-6 py-16 text-center sm:px-12">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Ready to turn WhatsApp chats into sales?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
            Start your free trial today. Our team will help you connect your number.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="rounded-xl bg-[#25D366] px-6 py-3.5 font-bold text-slate-950 hover:bg-[#1ebe5b]">
              Start 14-day free trial
            </Link>
            <Link href="/contact" className="rounded-xl border border-white/30 px-6 py-3.5 font-semibold text-white hover:bg-white/10">
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-bold tracking-wide text-[#128C7E] uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-lg text-slate-600">{subtitle}</p>}
    </div>
  );
}

function Highlight({
  icon: Icon,
  title,
  points,
}: {
  icon: typeof Bot;
  title: string;
  points: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-[#075E54] text-white">
          <Icon className="size-5" />
        </div>
        <h3 className="text-xl font-bold text-slate-900">{title}</h3>
      </div>
      <ul className="mt-5 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-slate-700">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#25D366]" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
