"use client";

import { useLocale } from "next-intl";
import type { Locale as DateFnsLocale } from "date-fns";
import { enUS, es, hi, ko, ptBR } from "date-fns/locale";

const DEVANAGARI_DIGITS = /[०-९]/g;

/** date-fns' Hindi locale writes digits as ०-९; the rest of the app
 *  (amounts, counts, times) uses 0-9, so convert for consistency. */
export function toLatinDigits(text: string): string {
  return text.replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966));
}

const hiLatinDigits: DateFnsLocale = {
  ...hi,
  formatDistance: (token, count, options) =>
    toLatinDigits(hi.formatDistance(token, count, options)),
};

const DATE_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  hi: hiLatinDigits,
  es,
  pt: ptBR,
  ko,
};

/**
 * date-fns locale matching the active UI language, so relative times
 * ("5 मिनट पहले") and month names follow the language picker.
 * Pass it as `{ locale }` to formatDistanceToNow / format.
 */
export function useDateLocale(): DateFnsLocale {
  return DATE_LOCALES[useLocale()] ?? enUS;
}
