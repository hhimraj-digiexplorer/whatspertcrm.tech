import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { loadBilling } from '@/lib/billing/server';
import { loadPlans, loadUsage } from '@/lib/billing/account-billing';
import { accessBlock, razorpayPlanId, trialDaysLeft } from '@/lib/billing/plans';
import { razorpayKeyId } from '@/lib/billing/razorpay';

// GET /api/billing — everything the Settings → Billing panel and the
// trial / suspension banner need, for any member of the account.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [{ billing, plan }, usage, plans] = await Promise.all([
      loadBilling(ctx.accountId),
      loadUsage(ctx.accountId),
      loadPlans({ publicOnly: true }),
    ]);
    const checkoutReady = Boolean(razorpayKeyId() && process.env.RAZORPAY_KEY_SECRET);

    return NextResponse.json({
      billing,
      plan,
      usage,
      block: accessBlock(billing),
      trialDaysLeft: trialDaysLeft(billing),
      // Only the owner manages billing (role hint: "Full control over
      // account and billing").
      canManage: ctx.role === 'owner',
      checkoutReady,
      plans: plans.map((p) => ({
        ...p,
        // The browser only needs to know whether a cycle is purchasable.
        razorpay_plan_id_monthly: undefined,
        razorpay_plan_id_yearly: undefined,
        buyable_monthly: checkoutReady && razorpayPlanId(p, 'monthly') !== null,
        buyable_yearly: checkoutReady && razorpayPlanId(p, 'yearly') !== null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
