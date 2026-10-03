import { ChevronDown } from "lucide-react";

export interface FaqItem {
  q: string;
  a: string;
}

/** Native <details> accordion — works without JavaScript and is indexable. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {items.map((item) => (
        <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-semibold text-slate-900">
            {item.q}
            <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-3 leading-relaxed text-slate-600">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
