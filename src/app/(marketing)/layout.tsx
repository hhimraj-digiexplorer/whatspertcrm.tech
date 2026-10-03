import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

// Public website (landing, pricing, contact, legal). Unlike the app,
// these pages should be indexed. Always light, whatever theme the
// visitor last used inside the app.
export const metadata: Metadata = {
  metadataBase: new URL(COMPANY.siteUrl),
  title: {
    default: `${BRAND_NAME} — WhatsApp CRM, inbox & broadcasts for Indian businesses`,
    template: `%s — ${BRAND_NAME}`,
  },
  description:
    "Sell and support on WhatsApp from one shared team inbox. Broadcast campaigns, no-code automations, an AI reply assistant and sales pipelines on the official WhatsApp Business API. 7-day free trial.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: BRAND_NAME,
    locale: "en_IN",
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
