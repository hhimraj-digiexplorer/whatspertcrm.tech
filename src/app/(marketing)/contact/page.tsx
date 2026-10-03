import type { Metadata } from "next";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { BRAND_NAME, COMPANY } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Contact us",
  description: `Talk to the ${BRAND_NAME} team about WhatsApp for your business, pricing or support.`,
};

export default function ContactPage() {
  const waLink = COMPANY.whatsappNumber
    ? `https://wa.me/${COMPANY.whatsappNumber}?text=${encodeURIComponent(`Hi! I'd like to know more about ${BRAND_NAME}.`)}`
    : null;

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Contact us</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        Questions about plans, connecting your WhatsApp number or anything else? We usually reply
        within one business day.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {waLink && (
          <ContactCard icon={MessageCircle} title="Chat on WhatsApp" body="Fastest way to reach us.">
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-[#25D366] px-4 py-2 text-sm font-bold text-slate-950 hover:bg-[#1ebe5b]">
              Open WhatsApp
            </a>
          </ContactCard>
        )}
        <ContactCard icon={Mail} title="Email" body="Sales, billing and support.">
          <a href={`mailto:${COMPANY.supportEmail}`} className="font-semibold text-[#128C7E] underline">
            {COMPANY.supportEmail}
          </a>
        </ContactCard>
        {COMPANY.phoneDisplay && (
          <ContactCard icon={Phone} title="Phone" body="Monday to Saturday, 10 am – 7 pm IST.">
            <span className="font-semibold text-slate-900">{COMPANY.phoneDisplay}</span>
          </ContactCard>
        )}
        <ContactCard icon={MapPin} title="Office" body={COMPANY.legalName}>
          <span className="text-slate-700">{COMPANY.address}</span>
        </ContactCard>
      </div>
    </section>
  );
}

function ContactCard({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof Mail;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex size-11 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#128C7E]">
        <Icon className="size-5" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}
