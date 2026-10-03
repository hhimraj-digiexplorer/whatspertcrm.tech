import { Bot, CheckCheck, Megaphone, Sparkles, Tag } from "lucide-react";

/**
 * Product illustration for the hero: a stylised inbox thread with an
 * AI-drafted reply and a broadcast stats card. Pure markup — no image
 * assets to keep in sync with the real UI.
 */
export function HeroMock() {
  return (
    <div className="relative mx-auto mb-24 w-full max-w-lg" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-tr from-[#25D366]/25 via-emerald-200/40 to-sky-200/40 blur-2xl" />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-[#075E54] px-4 py-3 text-white">
          <div className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">PV</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Priya Verma</p>
            <p className="text-xs text-white/70">Lead · Instagram ad · Assigned to Rahul</p>
          </div>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">23h left</span>
        </div>

        <div className="space-y-3 bg-[#efeae2] px-4 py-5 text-[13px] leading-snug">
          <Bubble side="in">Hi! Is the 2BHK in Gomti Nagar still available? 🏠</Bubble>
          <Bubble side="out" meta="10:42">
            Namaste Priya ji 🙏 Yes! 2 & 3 BHK units start at ₹68 lakh. Shall I share the floor plan?
          </Bubble>
          <Bubble side="in">Yes please, and site visit timings?</Bubble>
          <div className="ml-auto max-w-[85%] rounded-xl border border-dashed border-[#25D366] bg-white/90 p-3 shadow-sm">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#128C7E]">
              <Sparkles className="size-3.5" /> AI suggested reply
            </p>
            <p className="text-slate-700">
              Site visits run daily 10 am – 6 pm. Shall I book you for Saturday at 11 am?
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-600">
            <Tag className="size-3" /> Hot lead
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-600">
            <Bot className="size-3" /> Flow: Site visit
          </span>
          <span className="ml-auto">Deal · ₹68,00,000</span>
        </div>
      </div>

      <div className="absolute -bottom-24 -left-4 w-56 rounded-xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/10 sm:-left-10">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <Megaphone className="size-3.5 text-[#128C7E]" /> Diwali offer broadcast
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Sent" value="1,240" />
          <Stat label="Read" value="68%" />
          <Stat label="Replied" value="96" />
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, meta, children }: { side: "in" | "out"; meta?: string; children: React.ReactNode }) {
  return side === "in" ? (
    <div className="max-w-[80%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-slate-800 shadow-sm">{children}</div>
  ) : (
    <div className="ml-auto max-w-[80%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-slate-800 shadow-sm">
      {children}
      {meta && (
        <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
          {meta} <CheckCheck className="size-3 text-sky-500" />
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-bold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}
