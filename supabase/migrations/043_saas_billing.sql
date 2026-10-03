-- ============================================================
-- 043_saas_billing.sql — Plans, subscriptions, limits, suspension
--
-- Turns the install into a multi-client SaaS: every account gets a
-- plan and a billing record, plan limits are enforced in the
-- database, and a platform operator (super-admin) can suspend an
-- account or change its plan.
--
-- What this migration does
--   1. `plans` — the price list and limits, editable by the operator
--      from the super-admin panel. Readable by anyone (the public
--      pricing page lists them).
--   2. `account_billing` — one row per account: plan, subscription
--      status, trial end, Razorpay ids, suspension. Members may READ
--      their own row; there are NO write policies, so only the
--      service role (server code: Razorpay webhook, super-admin API)
--      can change it. Keeping this off `accounts` matters: account
--      admins may UPDATE `accounts` (name, currency) and must not be
--      able to grant themselves a plan.
--   3. `billing_events` — Razorpay webhook log, unique on event id so
--      a redelivered webhook is applied once.
--   4. A trigger that creates the billing row (14-day trial) for every
--      new account, and a backfill for existing accounts.
--   5. Limit triggers on `contacts` (max_contacts) and `profiles`
--      (max_members). They raise `PLAN_LIMIT:<limit>` so the app can
--      show a friendly upgrade message.
--   6. `account_plan_limits(account_id)` — the effective limits for an
--      account, used by the triggers and the server — and
--      `account_broadcast_usage(account_id, since)`, the broadcast
--      messages sent since a date (monthly quota).
--   7. `admin_list_accounts(...)` — one-query account list with owner,
--      billing and usage counts for the super-admin panel.
--   8. New accounts default to INR as the deal currency.
--
-- NULL in any max_* column means "unlimited".
-- Idempotent — safe to run more than once.
-- ============================================================

-- ============================================================
-- PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,32}$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Whole rupees. 0 = free.
  price_monthly_inr INTEGER NOT NULL DEFAULT 0 CHECK (price_monthly_inr >= 0),
  price_yearly_inr INTEGER NOT NULL DEFAULT 0 CHECK (price_yearly_inr >= 0),
  -- Razorpay plan ids (plan_XXXX), created in the Razorpay dashboard.
  -- A paid plan without one cannot be bought online yet.
  razorpay_plan_id_monthly TEXT,
  razorpay_plan_id_yearly TEXT,
  max_members INTEGER CHECK (max_members IS NULL OR max_members >= 1),
  max_contacts INTEGER CHECK (max_contacts IS NULL OR max_contacts >= 0),
  max_broadcast_recipients_per_month INTEGER
    CHECK (max_broadcast_recipients_per_month IS NULL OR max_broadcast_recipients_per_month >= 0),
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  flows_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  api_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Marketing bullets for the pricing page, e.g. ["Shared inbox", …].
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Hidden plans (e.g. trial, custom deals) are not listed publicly.
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  is_trial BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS plans_select ON plans;
CREATE POLICY plans_select ON plans FOR SELECT USING (TRUE);
GRANT SELECT ON plans TO anon, authenticated;

-- Starting price list. Placeholder values — the operator edits them
-- in the super-admin panel. ON CONFLICT DO NOTHING keeps edits made
-- after the first run.
INSERT INTO plans (id, name, description, price_monthly_inr, price_yearly_inr,
                   max_members, max_contacts, max_broadcast_recipients_per_month,
                   ai_enabled, flows_enabled, api_enabled, features,
                   is_public, is_trial, sort_order)
VALUES
  ('trial', 'Free trial', 'Try every feature free for 14 days.', 0, 0,
   3, 1000, 1000, TRUE, TRUE, TRUE,
   '["All features", "3 team members", "1,000 contacts", "1,000 broadcast messages"]'::jsonb,
   FALSE, TRUE, 0),
  ('starter', 'Starter', 'For small businesses starting on WhatsApp.', 999, 9990,
   2, 2500, 5000, FALSE, TRUE, FALSE,
   '["Shared team inbox", "2 team members", "2,500 contacts", "5,000 broadcast messages / month", "Automations & flows"]'::jsonb,
   TRUE, FALSE, 10),
  ('growth', 'Growth', 'For growing teams that sell on WhatsApp every day.', 2499, 24990,
   5, 15000, 25000, TRUE, TRUE, TRUE,
   '["Everything in Starter", "5 team members", "15,000 contacts", "25,000 broadcast messages / month", "AI reply assistant", "Public API & webhooks"]'::jsonb,
   TRUE, FALSE, 20),
  ('pro', 'Pro', 'For high-volume teams and agencies.', 5999, 59990,
   NULL, NULL, NULL, TRUE, TRUE, TRUE,
   '["Everything in Growth", "Unlimited team members", "Unlimited contacts", "Unlimited broadcasts", "Priority support"]'::jsonb,
   TRUE, FALSE, 30)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ACCOUNT_BILLING
-- ============================================================
CREATE TABLE IF NOT EXISTS account_billing (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'trial' REFERENCES plans(id) ON UPDATE CASCADE,
  -- trialing → active (paid) → past_due (renewal failed) → cancelled
  -- (stopped renewing; usable until current_period_end) → expired.
  status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'yearly')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  razorpay_customer_id TEXT,
  razorpay_subscription_id TEXT UNIQUE,
  -- Set by the platform operator. A suspended account can sign in and
  -- see a notice, but cannot send messages or change data.
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  -- Free-form operator notes (deal terms, contact person, …).
  admin_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_billing_plan ON account_billing(plan_id);
CREATE INDEX IF NOT EXISTS idx_account_billing_status ON account_billing(status);

ALTER TABLE account_billing ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON account_billing;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Read-only for members. Writes go through the service role only.
DROP POLICY IF EXISTS account_billing_select ON account_billing;
CREATE POLICY account_billing_select ON account_billing FOR SELECT
  USING (is_account_member(account_id));

-- Every new account starts a 14-day trial.
CREATE OR REPLACE FUNCTION create_account_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO account_billing (account_id, plan_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', NOW() + INTERVAL '14 days')
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_account_billing ON accounts;
CREATE TRIGGER create_account_billing AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION create_account_billing();

-- Backfill: existing accounts start a fresh trial today.
INSERT INTO account_billing (account_id, plan_id, status, trial_ends_at)
SELECT a.id, 'trial', 'trialing', NOW() + INTERVAL '14 days'
FROM accounts a
ON CONFLICT (account_id) DO NOTHING;

-- ============================================================
-- BILLING_EVENTS (Razorpay webhook log)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Razorpay's x-razorpay-event-id header. Unique → idempotent.
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_account
  ON billing_events(account_id, created_at DESC);

-- No policies: service role only.
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- EFFECTIVE LIMITS
-- ============================================================
-- Limits that apply to an account right now. An expired trial or
-- subscription keeps its plan row but the app blocks writes (see
-- account_is_active); the numeric limits still come from the plan.
CREATE OR REPLACE FUNCTION account_plan_limits(target_account_id UUID)
RETURNS TABLE (
  plan_id TEXT,
  max_members INTEGER,
  max_contacts INTEGER,
  max_broadcast_recipients_per_month INTEGER,
  ai_enabled BOOLEAN,
  flows_enabled BOOLEAN,
  api_enabled BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.max_members, p.max_contacts,
         p.max_broadcast_recipients_per_month,
         p.ai_enabled, p.flows_enabled, p.api_enabled
  FROM account_billing b
  JOIN plans p ON p.id = b.plan_id
  WHERE b.account_id = target_account_id;
$$;

-- Server-side only; the limit triggers call it as SECURITY DEFINER.
REVOKE ALL ON FUNCTION account_plan_limits(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION account_plan_limits(UUID) TO service_role;

-- Broadcast messages actually sent since `since` (the monthly quota
-- counts sends, not drafts). broadcast_recipients carries no
-- account_id, so it is reached through broadcasts.
CREATE OR REPLACE FUNCTION account_broadcast_usage(
  target_account_id UUID,
  since TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM broadcast_recipients r
  JOIN broadcasts b ON b.id = r.broadcast_id
  WHERE b.account_id = target_account_id
    AND r.sent_at >= since;
$$;

-- Server-side only (service role): it reveals usage for any account id.
REVOKE ALL ON FUNCTION account_broadcast_usage(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION account_broadcast_usage(UUID, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- LIMIT TRIGGERS
-- ============================================================
-- Contacts: block inserts past the plan's max_contacts. Counting per
-- insert is fine at CRM scale (indexed on account_id); bulk imports
-- are chunked by the client so the check runs per row.
CREATE OR REPLACE FUNCTION enforce_contact_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim INTEGER;
  used INTEGER;
BEGIN
  SELECT l.max_contacts INTO lim FROM account_plan_limits(NEW.account_id) l;
  IF lim IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO used FROM contacts WHERE account_id = NEW.account_id;
  IF used >= lim THEN
    RAISE EXCEPTION 'PLAN_LIMIT:contacts'
      USING ERRCODE = 'P0001',
            HINT = format('Your plan allows %s contacts. Upgrade to add more.', lim);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_contact_limit ON contacts;
CREATE TRIGGER enforce_contact_limit BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_contact_limit();

-- Members: block a profile from joining an account (invite redeem
-- moves profiles.account_id) once the plan's max_members is reached.
CREATE OR REPLACE FUNCTION enforce_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim INTEGER;
  used INTEGER;
BEGIN
  IF NEW.account_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id) THEN
    RETURN NEW;
  END IF;
  SELECT l.max_members INTO lim FROM account_plan_limits(NEW.account_id) l;
  IF lim IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO used FROM profiles WHERE account_id = NEW.account_id;
  IF used >= lim THEN
    RAISE EXCEPTION 'PLAN_LIMIT:members'
      USING ERRCODE = 'P0001',
            HINT = format('Your plan allows %s team members. Upgrade to add more.', lim);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_member_limit ON profiles;
CREATE TRIGGER enforce_member_limit BEFORE INSERT OR UPDATE OF account_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_member_limit();

-- ============================================================
-- SUPER-ADMIN ACCOUNT LIST
-- ============================================================
-- Every account with its owner, billing state and usage, filtered and
-- paged in SQL so the panel stays fast with thousands of tenants.
-- Service role only: the API checks SUPER_ADMIN_EMAILS first.
CREATE OR REPLACE FUNCTION admin_list_accounts(
  search TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT NULL,
  page_size INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  created_at TIMESTAMPTZ,
  owner_email TEXT,
  owner_name TEXT,
  plan_id TEXT,
  plan_name TEXT,
  status TEXT,
  billing_cycle TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  admin_notes TEXT,
  members INTEGER,
  contacts INTEGER,
  messages_30d INTEGER,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT a.id, a.name, a.created_at, a.owner_user_id,
           b.plan_id, b.status, b.billing_cycle, b.trial_ends_at,
           b.current_period_end, b.suspended_at, b.suspended_reason,
           b.admin_notes,
           op.email AS owner_email, op.full_name AS owner_name
    FROM accounts a
    LEFT JOIN account_billing b ON b.account_id = a.id
    LEFT JOIN profiles op ON op.user_id = a.owner_user_id
    WHERE (search IS NULL OR search = ''
           OR a.name ILIKE '%' || search || '%'
           OR op.email ILIKE '%' || search || '%')
      AND (status_filter IS NULL OR status_filter = ''
           OR (status_filter = 'suspended' AND b.suspended_at IS NOT NULL)
           OR (status_filter <> 'suspended' AND b.status = status_filter
               AND b.suspended_at IS NULL))
  )
  SELECT f.id, f.name, f.created_at, f.owner_email, f.owner_name,
         f.plan_id, p.name, f.status, f.billing_cycle, f.trial_ends_at,
         f.current_period_end, f.suspended_at, f.suspended_reason,
         COALESCE(f.admin_notes, ''),
         (SELECT COUNT(*)::INTEGER FROM profiles pr WHERE pr.account_id = f.id),
         (SELECT COUNT(*)::INTEGER FROM contacts c WHERE c.account_id = f.id),
         (SELECT COUNT(*)::INTEGER
            FROM messages m
            JOIN conversations cv ON cv.id = m.conversation_id
           WHERE cv.account_id = f.id
             AND m.created_at >= NOW() - INTERVAL '30 days'),
         COUNT(*) OVER ()
  FROM filtered f
  LEFT JOIN plans p ON p.id = f.plan_id
  ORDER BY f.created_at DESC
  LIMIT GREATEST(1, LEAST(page_size, 200))
  OFFSET GREATEST(0, page_offset);
$$;

REVOKE ALL ON FUNCTION admin_list_accounts(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_accounts(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

-- ============================================================
-- DEFAULT CURRENCY
-- ============================================================
ALTER TABLE accounts ALTER COLUMN default_currency SET DEFAULT 'INR';
