// Whatspert inside Real Expert's iframe.
//
// In a cross-site iframe the browser only sends cookies marked
// SameSite=None; Secure, and (Chrome, Edge, Firefox) keeps them in a
// partition per top-level site. Single sign-on from Real Expert sets
// the `wcrm_embed` marker; while it is present every Supabase client
// writes its session cookies with these options, so refreshes keep
// working inside the frame. Normal visits are unaffected.

export const EMBED_COOKIE = 'wcrm_embed'

export const EMBED_COOKIE_OPTIONS = {
  sameSite: 'none' as const,
  secure: true,
  partitioned: true,
  path: '/',
}

export function isEmbeddedRequest(getCookie: (name: string) => { value: string } | undefined): boolean {
  return getCookie(EMBED_COOKIE)?.value === '1'
}

/** In the browser: is this page running inside another site's frame? */
export function inCrossSiteFrame(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
