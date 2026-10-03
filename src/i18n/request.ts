import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale } from './locales';

export default getRequestConfig(async () => {
  // Per-browser choice (language picker) first, then the deployment
  // default from the environment, then English.
  const cookieStore = await cookies();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    process.env.NEXT_PUBLIC_APP_LOCALE,
  );

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
