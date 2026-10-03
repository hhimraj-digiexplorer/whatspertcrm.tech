"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Languages } from "lucide-react";
import { LOCALE_COOKIE, LOCALES, isLocale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Language switcher. Writes the locale cookie and re-renders the
 * server tree so every translated string updates in place.
 */
export function LanguagePicker({
  label,
  className,
}: {
  /** Accessible name for the select. */
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    if (!isLocale(next) || next === current) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground",
        pending && "opacity-60",
        className,
      )}
    >
      <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent pr-1 outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} className="bg-card text-foreground">
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
