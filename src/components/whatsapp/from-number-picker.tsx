"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Phone } from "lucide-react";

interface Option {
  id: string;
  label: string;
}

interface NumbersPayload {
  phone_number_id?: string;
  numbers?: { id: string; display_phone_number: string; verified_name: string | null }[];
  extra_numbers?: { phone_number_id: string; display_phone_number: string | null; label: string | null; status: string }[];
}

/**
 * "Send from" picker for workspaces with more than one WhatsApp number.
 * Renders nothing for a single-number workspace. Value "" = primary.
 */
export function FromNumberPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useTranslations("WhatsAppSetup");
  const [options, setOptions] = useState<Option[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/whatsapp/numbers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((b: NumbersPayload) => {
        if (!alive) return;
        const extras = (b.extra_numbers ?? []).filter((e) => e.status === "active");
        if (!b.phone_number_id || extras.length === 0) return setOptions([]);
        const display = (id: string) => b.numbers?.find((n) => n.id === id)?.display_phone_number ?? id;
        setOptions([
          { id: "", label: `${display(b.phone_number_id)} · ${t("primaryNumber")}` },
          ...extras.map((e) => ({
            id: e.phone_number_id,
            label: [e.display_phone_number ?? display(e.phone_number_id), e.label].filter(Boolean).join(" · "),
          })),
        ]);
      })
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [t]);

  if (!options || options.length === 0) return null;
  return (
    <label className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Phone className="size-4 text-emerald-500" /> {t("sendFrom")}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
      >
        {options.map((o) => (
          <option key={o.id || "primary"} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">{t("sendFromHint")}</span>
    </label>
  );
}
