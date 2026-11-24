import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
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

// Google tag (Analytics) for the public site only, never inside the app.
// Override with NEXT_PUBLIC_GOOGLE_TAG_ID; set it to "off" to disable.
const GOOGLE_TAG_ID = process.env.NEXT_PUBLIC_GOOGLE_TAG_ID ?? "GTM-PL5ZRZB9";
const tagOn = /^(GTM|G)-[A-Z0-9]+$/.test(GOOGLE_TAG_ID);

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      {tagOn && (
        <>
          <Script id="google-tag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());`}
          </Script>
          <Script
            id="google-tag"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtm.js?id=${GOOGLE_TAG_ID}`}
          />
        </>
      )}
    </div>
  );
}
