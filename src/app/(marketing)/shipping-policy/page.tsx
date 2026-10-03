import type { Metadata } from "next";
import { CompanyContact, LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Service delivery policy" };

export default function ShippingPolicyPage() {
  return (
    <LegalPage
      title="Service delivery policy"
      intro={<>{BRAND_NAME} is online software. Nothing is shipped physically.</>}
    >
      <h2>How the service is delivered</h2>
      <ul>
        <li>Your account is available as soon as you sign up and confirm your email.</li>
        <li>After a successful payment, your plan is activated immediately — usually within a minute — and you will see it in Settings → Billing &amp; plan.</li>
        <li>Payment confirmations and invoices are sent to the account owner&apos;s email address.</li>
        <li>Connecting your WhatsApp number depends on Meta&apos;s verification of your business and number, which is outside our control but typically completes within 1–2 business days.</li>
      </ul>

      <h2>If something doesn&apos;t arrive</h2>
      <p>
        If your plan has not activated within 30 minutes of a successful payment, contact us with the
        payment reference and we will fix it the same business day.
      </p>

      <h2>Contact</h2>
      <CompanyContact />
    </LegalPage>
  );
}
