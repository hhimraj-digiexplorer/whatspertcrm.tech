import type { Metadata } from "next";
import { CompanyContact, LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <>
          This policy explains how {COMPANY.legalName} handles personal data in connection with{" "}
          {BRAND_NAME}, in line with the Digital Personal Data Protection Act, 2023 and the
          Information Technology Act, 2000.
        </>
      }
    >
      <h2>1. Two kinds of data</h2>
      <ul>
        <li>
          <strong>Account data</strong> — information about you and your team that we use to run your
          account. For this we are the data fiduciary.
        </li>
        <li>
          <strong>Customer data</strong> — the contacts, conversations and files you store in{" "}
          {BRAND_NAME} about your own customers. For this your business is the data fiduciary and we
          process it only on your instructions to provide the Service.
        </li>
      </ul>

      <h2>2. What we collect</h2>
      <ul>
        <li>Name, email, password (stored hashed), profile photo and role of each user.</li>
        <li>Business name, plan, billing status and Razorpay subscription and payment references. Card, UPI and bank details are handled by Razorpay; we do not store them.</li>
        <li>WhatsApp Business account identifiers and access tokens you connect (tokens are encrypted).</li>
        <li>Technical data such as IP address, browser and usage logs, used for security and troubleshooting.</li>
        <li>Messages you send us through the contact page, email or WhatsApp.</li>
      </ul>

      <h2>3. How we use it</h2>
      <ul>
        <li>To provide, secure and support the Service and your account.</li>
        <li>To process payments, send invoices and service notices.</li>
        <li>To prevent abuse and comply with legal obligations.</li>
        <li>To improve the Service using aggregated, non-identifying statistics.</li>
      </ul>
      <p>We do not sell personal data or use customer data for advertising.</p>

      <h2>4. Who we share it with</h2>
      <p>Only with service providers needed to run the Service, under contracts that protect the data:</p>
      <ul>
        <li>Supabase — database, authentication and file storage.</li>
        <li>Our hosting provider — running the application.</li>
        <li>Meta — sending and receiving WhatsApp messages you choose to send.</li>
        <li>Razorpay — payments and subscriptions.</li>
        <li>OpenAI or Anthropic — only if you switch on the AI assistant with your own API key; relevant conversation text is sent to the provider you choose.</li>
      </ul>
      <p>We may also disclose data when required by law or to protect rights and safety.</p>

      <h2>5. Where and how long</h2>
      <p>
        Data may be stored and processed on servers in India or other countries where our providers
        operate, with appropriate safeguards. We keep account data for as long as your account is open
        and as needed for legal, tax and accounting obligations. After an account is closed, customer
        data is deleted within 30 days unless you ask us to export it first, or the law requires us to
        keep it.
      </p>

      <h2>6. Security</h2>
      <p>
        We use encryption in transit, encrypted storage of WhatsApp and AI keys, account-level access
        controls and role-based permissions. No system is perfectly secure; if a breach affects your
        personal data we will notify you and the authorities as required by law.
      </p>

      <h2>7. Your rights</h2>
      <p>
        You can access, correct or delete your account data from the app or by writing to us, withdraw
        consent where processing is based on consent, and nominate another person to exercise your
        rights. If you are a contact of one of our customers, please contact that business first; we
        will help them respond.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use essential cookies to keep you signed in and remember preferences such as language. We
        do not use advertising cookies in the app.
      </p>

      <h2>9. Grievance officer</h2>
      <p>
        For privacy questions or complaints, contact our grievance officer at{" "}
        <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. We will acknowledge
        your complaint within 48 hours and aim to resolve it within 30 days.
      </p>

      <h2>10. Changes</h2>
      <p>We will post updates here and notify account owners of material changes.</p>

      <h2>11. Contact</h2>
      <CompanyContact />
    </LegalPage>
  );
}
