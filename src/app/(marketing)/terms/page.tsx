import type { Metadata } from "next";
import Link from "next/link";
import { CompanyContact, LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={
        <>
          These terms govern your use of {BRAND_NAME} (the &quot;Service&quot;), provided by{" "}
          {COMPANY.legalName} (&quot;we&quot;, &quot;us&quot;). By creating an account or using the
          Service you agree to them on behalf of yourself and the business you represent.
        </>
      }
    >
      <h2>1. The Service</h2>
      <p>
        {BRAND_NAME} is software for managing WhatsApp conversations, contacts, broadcasts,
        automations and sales pipelines using the WhatsApp Business Platform provided by Meta
        Platforms, Inc. (&quot;Meta&quot;). We are not affiliated with Meta. Your use of WhatsApp is
        also governed by Meta&apos;s WhatsApp Business terms and policies, which you must accept and
        follow.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and authorised to bind your business to these terms.</li>
        <li>Keep your login details secure. You are responsible for activity under your account, including your team members.</li>
        <li>Give us accurate account and billing information and keep it up to date.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>message people who have not opted in to hear from you, or send spam;</li>
        <li>break WhatsApp&apos;s Business and Commerce policies or any applicable law, including the Information Technology Act, 2000 and consumer protection rules;</li>
        <li>send unlawful, fraudulent, misleading, abusive or infringing content;</li>
        <li>attempt to access other customers&apos; data, disrupt the Service or reverse-engineer it.</li>
      </ul>
      <p>
        Meta may restrict or ban numbers that break its policies; we are not responsible for actions
        Meta takes on your WhatsApp Business account.
      </p>

      <h2>4. Free trial</h2>
      <p>
        New accounts get a 7-day free trial. When it ends, sending messages pauses until you choose a
        paid plan. Your data is kept so you can continue where you left off.
      </p>

      <h2>5. Plans, payment and renewal</h2>
      <ul>
        <li>Paid plans are billed in advance, monthly or yearly, in Indian rupees, through Razorpay. Applicable taxes, including GST, are added.</li>
        <li>Subscriptions renew automatically at the end of each period until cancelled.</li>
        <li>If a renewal payment fails we may pause sending after a short grace period.</li>
        <li>WhatsApp conversation charges are billed by Meta directly and are not part of our fees.</li>
        <li>We may change prices with at least 30 days&apos; notice; changes apply from your next renewal.</li>
      </ul>
      <p>
        Cancellations and refunds are covered by our{" "}
        <Link href="/refund-policy">refund &amp; cancellation policy</Link>.
      </p>

      <h2>6. Your data</h2>
      <p>
        You own the contacts, messages and other content you put into the Service (&quot;Customer
        Data&quot;). You give us permission to store and process it only to provide the Service. You are
        responsible for having a lawful basis, including consent where required, to process the
        personal data of your contacts. How we handle personal data is described in our{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The Service connects to services you choose, such as Meta&apos;s WhatsApp Business Platform,
        Razorpay and optional AI providers (OpenAI or Anthropic) using your own API key. Their terms
        apply to your use of them, and we are not responsible for their availability or actions.
      </p>

      <h2>8. Suspension and termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or close an account that breaks
        these terms, puts other customers or the Service at risk, or has unpaid fees. Where reasonable
        we will tell you first and give you a chance to fix the problem. After closure you may ask us
        to export your Customer Data within 30 days; after that it may be deleted.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We work to keep the Service available and secure but do not guarantee it will be
        uninterrupted or error-free. We may improve or change features; we will not remove core
        functionality of a paid plan during a period you have already paid for without a pro-rata
        refund.
      </p>

      <h2>10. Liability</h2>
      <p>
        To the extent permitted by law, the Service is provided &quot;as is&quot;, and our total
        liability for any claim relating to the Service is limited to the fees you paid us in the 12
        months before the claim. We are not liable for indirect or consequential losses, lost profits,
        or for actions taken by Meta or other third parties.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of India. The courts at {COMPANY.jurisdiction} have
        exclusive jurisdiction over any dispute.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms. We will notify account owners of material changes by email or in
        the app at least 15 days before they take effect.
      </p>

      <h2>13. Contact</h2>
      <CompanyContact />
    </LegalPage>
  );
}
