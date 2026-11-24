-- ============================================================
-- 050_account_ai_access.sql
--
-- Per-account AI Agents controls for the platform admin:
--   ai_access          'plan' (follow the plan's ai_enabled, default),
--                      'enabled' (on regardless of plan), 'disabled'
--   ai_key_source      'client' (bring your own key, default) or
--                      'platform' (Whatspert's key from the server
--                      config, PLATFORM_AI_*)
--   ai_platform_fee_inr  monthly add-on for the Whatspert key, shown to
--                      the client and the admin (default ₹1,000)
-- ai_configs.api_key becomes nullable: a workspace on the Whatspert key
-- keeps its prompt and toggles without a key of its own. Idempotent.
-- ============================================================

ALTER TABLE account_billing ADD COLUMN IF NOT EXISTS ai_access text NOT NULL DEFAULT 'plan';
ALTER TABLE account_billing ADD COLUMN IF NOT EXISTS ai_key_source text NOT NULL DEFAULT 'client';
ALTER TABLE account_billing ADD COLUMN IF NOT EXISTS ai_platform_fee_inr integer NOT NULL DEFAULT 1000;

DO $$ BEGIN
  ALTER TABLE account_billing ADD CONSTRAINT account_billing_ai_access_check
    CHECK (ai_access IN ('plan', 'enabled', 'disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE account_billing ADD CONSTRAINT account_billing_ai_key_source_check
    CHECK (ai_key_source IN ('client', 'platform'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE account_billing ADD CONSTRAINT account_billing_ai_fee_check
    CHECK (ai_platform_fee_inr >= 0 AND ai_platform_fee_inr <= 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE ai_configs ALTER COLUMN api_key DROP NOT NULL;
