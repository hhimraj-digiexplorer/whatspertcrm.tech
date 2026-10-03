# Running Whatspert CRM as a SaaS

One-time setup for selling Whatspert CRM to clients: the database
migration, Razorpay, the super-admin panel, plans, and the public website.

## 1. Apply the database migration

Run `supabase/migrations/043_saas_billing.sql` (or `supabase db push`). It:

- creates `plans` with starting prices (Starter ₹999, Growth ₹2,499, Pro ₹5,999 a
  month) — placeholders you edit in step 4;
- gives every existing and new account a free trial (7 days from migration 047);
- enforces each plan's contact and team-member limits in the database.

Then run `047_pricing_v2.sql`, which sets the live price list (prices
exclude 18% GST):

| Plan | Yearly | Month-to-month | Contacts | Messages / month | Agent logins |
|---|---|---|---|---|---|
| Free trial (7 days) | ₹0 | — | 1,000 | 1,000 | 1 |
| Growth | ₹6,840 (₹570/mo) | ₹1,140 | 20,000 | 1,00,000 | 5 |
| Scale | ₹11,400 (₹950/mo) | ₹1,900 | 50,000 | 2,00,000 | 10 |

The old Starter and Pro plans are hidden but kept for anyone already on them.

## 2. Environment variables

| Variable | What it does |
|---|---|
| `SUPER_ADMIN_EMAILS` | Comma-separated emails allowed into `/admin`. These people can see and change every client account. The email must be confirmed. |
| `RAZORPAY_KEY_ID` | From Razorpay Dashboard → Account & Settings → API keys. Use `rzp_test_…` while testing. |
| `RAZORPAY_KEY_SECRET` | The matching secret. |
| `RAZORPAY_WEBHOOK_SECRET` | Any long random string; the same value goes on the webhook in step 3. |
| `NEXT_PUBLIC_SITE_URL` | `https://whatspertcrm.tech` |

Without the Razorpay variables the app still works: clients see their plan and
usage, and you assign plans by hand from `/admin`.

## 3. Razorpay

1. **Plans** — Razorpay Dashboard → Subscriptions → Plans → Create plan, once per
   price you sell. GST is charged on top, so create each plan **including 18%
   GST** and copy each `plan_…` id into `/admin` → Plans:

   | Razorpay plan | Period | Amount (incl. GST) |
   |---|---|---|
   | Growth yearly | yearly | ₹8,071.20 |
   | Growth monthly | monthly | ₹1,345.20 |
   | Scale yearly | yearly | ₹13,452.00 |
   | Scale monthly | monthly | ₹2,242.00 |
2. **Webhook** — Razorpay Dashboard → Account & Settings → Webhooks → Add:
   - URL: `https://whatspertcrm.tech/api/billing/webhook`
   - Secret: your `RAZORPAY_WEBHOOK_SECRET`
   - Events: all `subscription.*` events
3. **Website checks** — before enabling live mode Razorpay reviews your site.
   The required pages are already there: `/terms`, `/privacy`, `/refund-policy`,
   `/shipping-policy`, `/contact`, `/pricing`.

## 4. Plans and prices (`/admin` → Plans & pricing)

For each plan set the prices in whole rupees (before GST), paste the Razorpay
plan ids, and set limits (leave empty for unlimited) and features. Changes apply
to every account on that plan immediately, and the public pricing page updates
too. A plan with no Razorpay id for a cycle shows "Contact us to buy" for it.

## 5. Day-to-day (`/admin` → Client accounts)

- **Offline payment / special deal** — set the plan, status "Paying", billing
  cycle and "Paid until".
- **Extend a trial** — add days.
- **Suspend** — stops the account sending messages (it can still sign in and see a
  notice with your reason). Restore at any time.
- **Notes** — internal only, e.g. GSTIN or deal terms.

## 6. Your business details

Edit `COMPANY` in `src/lib/brand.ts`: registered address, phone, WhatsApp number
(shows a "Chat on WhatsApp" button on `/contact`) and GSTIN. These appear in the
footer, contact page and legal pages. Have the legal pages reviewed by your
lawyer before launch — they are sensible starting drafts, not legal advice.

## What clients experience

- Sign-up starts a 14-day trial with every feature; a banner appears in the last
  3 days.
- When a trial or subscription ends, or you suspend an account, sending stops
  everywhere: inbox, broadcasts, the public API, automations, flows and the AI bot.
  Data is kept.
- The owner upgrades in Settings → Billing & plan and pays by UPI, card or
  netbanking; the plan applies immediately.
- Cancelling stops renewal; access continues until the paid period ends.
