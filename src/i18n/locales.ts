/**
 * UI languages the app ships. Each code must have a catalogue at
 * messages/<code>.json. The order here drives the language picker.
 *
 * The active language is per browser: the picker writes LOCALE_COOKIE
 * and src/i18n/request.ts reads it on every request, falling back to
 * NEXT_PUBLIC_APP_LOCALE (the deployment default) and then English.
 */
export const LOCALES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ko", label: "한국어" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((l) => l.code === value);
}

/** Cookie wins, then the deployment default, then English. */
export function resolveLocale(
  cookieValue: string | undefined,
  envDefault: string | undefined,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (isLocale(envDefault)) return envDefault;
  return DEFAULT_LOCALE;
}
