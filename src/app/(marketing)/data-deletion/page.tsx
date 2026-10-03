import type { Metadata } from "next";
import { CompanyContact, LegalPage } from "@/components/marketing/legal-page";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

export const metadata: Metadata = { title: "Data deletion" };

/**
 * Data deletion instructions. This is the "Data deletion instructions
 * URL" given to Meta in the app's Basic settings.
 */
export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Data deletion"
      intro={
        <>
          How to remove data held by {BRAND_NAME}, including data received when you connected WhatsApp
          through Facebook.
        </>
      }
    >
      <h2>Disconnect Facebook and WhatsApp</h2>
      <p>
        If you connected your WhatsApp Business Account with the &ldquo;Connect with Facebook&rdquo;
        button, you can remove our access at any time:
      </p>
      <ul>
        <li>
          In {BRAND_NAME}, open <strong>WhatsApp setup</strong> and disconnect the number. We delete
          the stored access token and stop receiving messages for it.
        </li>
        <li>
          In Facebook, go to <strong>Settings &amp; privacy → Settings → Business integrations</strong>,
          select {BRAND_NAME} and choose <strong>Remove</strong>. Meta then stops sharing data with us
          and notifies us to delete it.
        </li>
        <li>
          In Meta Business Suite, under <strong>Business settings → Integrations → Connected apps</strong>,
          you can also remove {BRAND_NAME} from your business portfolio.
        </li>
      </ul>

      <h2>Delete your whole account</h2>
      <p>
        The account owner can ask us to delete the account and all of its data by emailing{" "}
        <a href={`mailto:${COMPANY.supportEmail}?subject=Delete%20my%20account`}>{COMPANY.supportEmail}</a>{" "}
        from the owner&apos;s email address with the subject &ldquo;Delete my account&rdquo;. We may
        ask you to confirm the request from inside the app.
      </p>
      <p>Within 30 days we permanently delete:</p>
      <ul>
        <li>your workspace, team members and their logins;</li>
        <li>contacts, conversations, messages, media, templates, broadcasts, deals and automations;</li>
        <li>WhatsApp, AI and CRM credentials, API keys and webhooks;</li>
        <li>data received from Facebook and WhatsApp, including business account and phone number details.</li>
      </ul>
      <p>
        We keep invoices and payment records for as long as Indian tax law requires. Backups are
        overwritten within a further 30 days. Messages already delivered to WhatsApp users stay on
        their phones, and Meta keeps its own records under its own policies.
      </p>

      <h2>If you are a contact of one of our customers</h2>
      <p>
        Businesses use {BRAND_NAME} to message their customers. If a business messaged you on WhatsApp
        and you want your data removed, ask that business first — they control their contact list. You
        can also write to us with the business name and your phone number and we will pass the request
        on and help them complete it. Replying <strong>STOP</strong> to the business on WhatsApp stops
        marketing messages.
      </p>

      <h2>Confirmation</h2>
      <p>
        We confirm by email once deletion is complete. Questions about a request can be sent to{" "}
        <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
      </p>

      <h2>Contact</h2>
      <CompanyContact />
    </LegalPage>
  );
}
