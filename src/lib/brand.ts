/**
 * Product identity. Change these to re-brand the app; the wordmark,
 * page titles and favicon all read from here. User-facing sentences
 * that mention the product live in the message catalogs (messages/*.json).
 */
export const BRAND_NAME = "Whatspert CRM";
export const BRAND_TAGLINE =
  "WhatsApp CRM — shared inbox, contacts, pipelines, broadcasts and automations.";
/** Mark background — WhatsApp green. Mirrors the default accent theme. */
export const BRAND_COLOR = "#25D366";

/** Chat bubble + "W" glyph, drawn on a 24×24 grid. Shared by the
 *  in-app logo and the generated favicon so they never drift. */
export const LOGO_BUBBLE_PATH =
  "M12 3.5a8 8 0 1 1-3.9 15l-3.6 1 1-3.4A8 8 0 0 1 12 3.5z";
export const LOGO_W_POINTS = "7.8,8.9 9.6,14.4 12,10.3 14.4,14.4 16.2,8.9";

/**
 * The business behind the product — shown on the public site, the
 * legal pages and the footer. Razorpay checks these pages (legal name,
 * address, contact) before activating live payments.
 *
 * TODO(owner): replace every "[…]" placeholder with the real details.
 */
export const COMPANY = {
  legalName: "DigiExplorer Branding Solution",
  address: "[Street address], Lucknow, Uttar Pradesh [PIN], India",
  city: "Lucknow, Uttar Pradesh, India",
  supportEmail: "support@whatspertcrm.tech",
  /** E.164 without "+", used for the wa.me chat link; "" hides it. */
  whatsappNumber: "",
  phoneDisplay: "",
  gstin: "",
  siteUrl: "https://whatspertcrm.tech",
  /** Courts named in the Terms. */
  jurisdiction: "Lucknow, Uttar Pradesh",
  legalUpdated: "3 October 2026",
} as const;
