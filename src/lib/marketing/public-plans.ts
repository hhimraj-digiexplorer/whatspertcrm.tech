import { loadPlans } from "@/lib/billing/account-billing";
import type { PublicPlan } from "@/components/marketing/pricing-cards";

/**
 * Plans shown on the public site. Falls back to an empty list (the
 * page says "contact us") rather than failing the whole page when the
 * database is unreachable.
 */
export async function getPublicPlans(): Promise<PublicPlan[]> {
  try {
    const plans = await loadPlans({ publicOnly: true });
    return plans
      .filter((p) => !p.is_trial)
      .map(({ id, name, description, price_monthly_inr, price_yearly_inr, features }) => ({
        id,
        name,
        description,
        price_monthly_inr,
        price_yearly_inr,
        features,
      }));
  } catch (err) {
    console.error("[marketing] could not load plans:", err);
    return [];
  }
}
