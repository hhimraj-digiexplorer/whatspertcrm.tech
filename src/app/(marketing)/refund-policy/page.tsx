import type { Metadata } from "next";
import { CompanyContact, LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

export const metadata: Metadata = { title: "Refund & cancellation policy" };

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund & cancellation policy"
      intro={<>How cancelling and refunds work for {BRAND_NAME} subscriptions.</>}
    >
      <h2>Free trial</h2>
      <p>
        Every account starts with a free 14-day trial. No payment is taken during the trial, so there
        is nothing to refund.
      </p>

      <h2>Cancelling</h2>
      <ul>
        <li>The account owner can cancel anytime from Settings → Billing &amp; plan, or by emailing us.</li>
        <li>Cancelling stops future renewals. You keep full access until the end of the period you have already paid for.</li>
        <li>No further charges are made after cancellation.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>
          <strong>First payment:</strong> if you are not satisfied, you can ask for a full refund of
          your first subscription payment within 7 days of that payment.
        </li>
        <li>
          <strong>Duplicate or incorrect charges:</strong> refunded in full once verified.
        </li>
        <li>
          <strong>Service unavailable:</strong> if the Service is unavailable for a significant part of
          a paid period because of a fault on our side, we will refund or credit the affected portion.
        </li>
        <li>
          Otherwise, payments for a period that has started are not refundable, including for unused
          time after cancelling.
        </li>
        <li>
          Charges made by Meta for WhatsApp conversations are billed by Meta and are not refundable by
          us.
        </li>
      </ul>

      <h2>How to ask for a refund</h2>
      <p>
        Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> from the account
        owner&apos;s email with your business name and the payment reference. We respond within 2
        business days. Approved refunds are returned to the original payment method through Razorpay,
        usually within 5–7 business days.
      </p>

      <h2>Contact</h2>
      <CompanyContact />
    </LegalPage>
  );
}
