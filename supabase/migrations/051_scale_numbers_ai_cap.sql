-- ============================================================
-- 051_scale_numbers_ai_cap.sql
--
-- 1. Scale plan: "WhatsApp number: 1" → "WhatsApp numbers: up to 5".
-- 2. account_billing.ai_platform_conversation_limit: AI chatbot
--    conversations a month included with the Whatspert AI key
--    (default 2,500). Idempotent.
-- ============================================================

-- Replace the "WhatsApp number: 1" line (as edited in the admin panel
-- it may differ; only that exact seed value is replaced).
UPDATE plans
   SET features = (
     SELECT jsonb_agg(CASE WHEN v = '"WhatsApp number: 1"'::jsonb
                           THEN '"WhatsApp numbers: up to 5"'::jsonb ELSE v END)
       FROM jsonb_array_elements(features) v
   )
 WHERE id = 'scale' AND features @> '["WhatsApp number: 1"]'::jsonb;

ALTER TABLE account_billing
  ADD COLUMN IF NOT EXISTS ai_platform_conversation_limit integer NOT NULL DEFAULT 2500;
DO $$ BEGIN
  ALTER TABLE account_billing ADD CONSTRAINT account_billing_ai_conv_limit_check
    CHECK (ai_platform_conversation_limit >= 0 AND ai_platform_conversation_limit <= 10000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_account_month
  ON ai_usage_log (account_id, created_at DESC);
