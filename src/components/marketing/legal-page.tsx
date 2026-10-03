import type { ReactNode } from "react";
import { COMPANY } from "@/lib/brand";

/** Shared shell for Terms, Privacy, Refund and Delivery pages. */
export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-slate-500">Last updated: {COMPANY.legalUpdated}</p>
      {intro && <div className="mt-6 text-lg leading-relaxed text-slate-700">{intro}</div>}
      <div
        className={[
          "mt-10 space-y-4 leading-relaxed text-slate-700",
          "[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900",
          "[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6",
          "[&_a]:font-medium [&_a]:text-[#128C7E] [&_a]:underline",
        ].join(" ")}
      >
        {children}
      </div>
    </article>
  );
}

/** The business identity block every policy ends with. */
export function CompanyContact() {
  return (
    <p>
      {COMPANY.legalName}
      <br />
      {COMPANY.address}
      <br />
      Email: <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>
      {COMPANY.phoneDisplay ? (
        <>
          <br />
          Phone: {COMPANY.phoneDisplay}
        </>
      ) : null}
      {COMPANY.gstin ? (
        <>
          <br />
          GSTIN: {COMPANY.gstin}
        </>
      ) : null}
    </p>
  );
}
