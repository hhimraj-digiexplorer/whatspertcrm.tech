// Features every plan includes, listed under each plan's own limits on
// the pricing page. Only list what the product really does today.
export const PLAN_FEATURES: string[] = [
  "Shared team inbox",
  "Bulk broadcasting",
  "Scheduled broadcasts",
  "WhatsApp automation",
  "Chatbot flow builder",
  "WhatsApp AI agent",
  "Interactive buttons & lists",
  "Audience segmentation (tags)",
  "Bulk contact import",
  "Contact list management",
  "Template management",
  "Quick replies",
  "Sales pipelines",
  "Real Expert CRM integration",
  "Outbound webhooks",
  "Inbound lead webhook",
  "Developer API",
];

/** GST added on top of every plan price. */
export const GST_RATE = 0.18;

/** Percentage saved by paying yearly instead of month-to-month. */
export function yearlyDiscountPct(monthly: number, yearly: number): number {
  if (monthly <= 0 || yearly <= 0) return 0;
  return Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100));
}
