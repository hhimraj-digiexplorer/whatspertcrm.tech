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

/** Logo artwork in /public/brand. The favicon and Apple touch icon are
 *  src/app/icon.png and src/app/apple-icon.png (same mark). */
export const LOGO_MARK_SRC = "/brand/logo-mark.png";
export const LOGO_LOCKUP_SRC = "/brand/logo-lockup.png";

/**
 * The business behind the product — shown on the public site, the
 * legal pages and the footer. Razorpay and Meta business verification
 * compare these with the GST registration certificate, so keep them
 * exactly as registered (GSTIN 09ALRPH8178A1ZR).
 *
 * TODO(owner): add the business phone number.
 */
export const COMPANY = {
  /** Trade name on the GST certificate. */
  legalName: "Digi Explorer Branding Solution",
  /** Sole proprietorship; the proprietor is the legal entity. */
  proprietor: "Himanshu Himraj",
  address: "1/163, Vibhav Khand, Gomti Nagar, Lucknow, Uttar Pradesh 226010, India",
  city: "Lucknow, Uttar Pradesh, India",
  supportEmail: "support@whatspertcrm.tech",
  /** E.164 without "+", used for the wa.me chat link; "" hides it. */
  whatsappNumber: "",
  phoneDisplay: "",
  gstin: "09ALRPH8178A1ZR",
  siteUrl: "https://whatspertcrm.tech",
  /** Courts named in the Terms. */
  jurisdiction: "Lucknow, Uttar Pradesh",
  legalUpdated: "3 October 2026",
} as const;
