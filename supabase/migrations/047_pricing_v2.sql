-- ============================================================
-- 047_pricing_v2.sql — new price list
--
--   Trial   ₹0, 7 days      1,000 contacts · 1,000 messages · 1 login
--   Growth  ₹570/mo yearly (₹6,840/yr) or ₹1,140 month-to-month
--           20,000 contacts · 1 lakh messages/month · 5 logins
--   Scale   ₹950/mo yearly (₹11,400/yr) or ₹1,900 month-to-month
--           50,000 contacts · 2 lakh messages/month · 10 logins
--
-- Prices exclude 18% GST. Yearly billing is 50% off month-to-month.
-- The old Starter and Pro plans are hidden, not deleted: accounts
-- already on them keep their plan until they change it.
--
-- Idempotent.
-- ============================================================

UPDATE plans SET
  description = 'Try every feature free for 7 days. No credit card required.',
  max_members = 1,
  max_contacts = 1000,
  max_broadcast_recipients_per_month = 1000,
  ai_enabled = TRUE, flows_enabled = TRUE, api_enabled = TRUE,
  features = '["Contacts: 1,000", "WhatsApp number: 1", "Messages: 1,000", "Agent logins: 1", "Every feature included"]'::jsonb
WHERE id = 'trial';

INSERT INTO plans (id, name, description, price_monthly_inr, price_yearly_inr,
                   max_members, max_contacts, max_broadcast_recipients_per_month,
                   ai_enabled, flows_enabled, api_enabled, features,
                   is_public, is_trial, sort_order)
VALUES
  ('growth', 'Growth', 'For growing teams that sell on WhatsApp every day.', 1140, 6840,
   5, 20000, 100000, TRUE, TRUE, TRUE, '[]'::jsonb, TRUE, FALSE, 20),
  ('scale', 'Scale', 'For high-volume teams and agencies.', 1900, 11400,
   10, 50000, 200000, TRUE, TRUE, TRUE, '[]'::jsonb, TRUE, FALSE, 30)
ON CONFLICT (id) DO NOTHING;

UPDATE plans SET
  name = 'Growth',
  description = 'For growing teams that sell on WhatsApp every day.',
  price_monthly_inr = 1140,
  price_yearly_inr = 6840,
  max_members = 5,
  max_contacts = 20000,
  max_broadcast_recipients_per_month = 100000,
  ai_enabled = TRUE, flows_enabled = TRUE, api_enabled = TRUE,
  is_public = TRUE,
  sort_order = 20,
  features = '["Contacts: 20,000", "WhatsApp number: 1", "Messages: 1 lakh / month", "Agent logins: 5"]'::jsonb
WHERE id = 'growth';

UPDATE plans SET
  name = 'Scale',
  description = 'For high-volume teams and agencies.',
  price_monthly_inr = 1900,
  price_yearly_inr = 11400,
  max_members = 10,
  max_contacts = 50000,
  max_broadcast_recipients_per_month = 200000,
  ai_enabled = TRUE, flows_enabled = TRUE, api_enabled = TRUE,
  is_public = TRUE,
  sort_order = 30,
  features = '["Contacts: 50,000", "WhatsApp number: 1", "Messages: 2 lakh / month", "Agent logins: 10"]'::jsonb
WHERE id = 'scale';

UPDATE plans SET is_public = FALSE WHERE id IN ('starter', 'pro');

-- New accounts get a 7-day trial (was 14). Running trials keep their end date.
CREATE OR REPLACE FUNCTION create_account_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO account_billing (account_id, plan_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', NOW() + INTERVAL '7 days')
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;
