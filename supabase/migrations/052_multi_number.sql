-- ============================================================
-- 052_multi_number.sql
--
-- More than one WhatsApp number per workspace (Scale: up to 5).
--
-- The workspace's primary number stays in whatsapp_config (with the
-- WABA id and the token every send uses). Additional numbers live in
-- whatsapp_numbers and must belong to the same WhatsApp Business
-- Account, so they share its templates and token.
--
--   whatsapp_numbers           extra numbers in the workspace
--   conversations.phone_number_id  the number the customer last wrote
--                              to; replies go out from it
--   broadcasts.phone_number_id the number a broadcast sends from
--                              (NULL = primary)
--   plans.max_whatsapp_numbers numbers allowed in total (primary
--                              included); Scale and Pro 5, others 1
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_number_id       text NOT NULL,
  -- The WABA it belongs to; must match whatsapp_config.waba_id. Rows
  -- from a previously connected WABA are pruned on reconnect.
  waba_id               text NOT NULL,
  display_phone_number  text,
  verified_name         text,
  -- Short name the team sees, e.g. "Sales" or "Site office".
  label                 text,
  two_step_pin          text,
  status                text NOT NULL DEFAULT 'active',
  registered_at         timestamptz,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_numbers_phone_number_id_key UNIQUE (phone_number_id),
  CONSTRAINT whatsapp_numbers_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT whatsapp_numbers_label_len CHECK (label IS NULL OR char_length(label) <= 40)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_account ON whatsapp_numbers(account_id);

ALTER TABLE whatsapp_numbers ENABLE ROW LEVEL SECURITY;

-- Everyone in the workspace can see which numbers exist (inbox badges,
-- broadcast picker); only admins change them. The PIN column is never
-- selected by the client — the API reads it with the service role.
DROP POLICY IF EXISTS whatsapp_numbers_select ON whatsapp_numbers;
CREATE POLICY whatsapp_numbers_select ON whatsapp_numbers FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS whatsapp_numbers_insert ON whatsapp_numbers;
CREATE POLICY whatsapp_numbers_insert ON whatsapp_numbers FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS whatsapp_numbers_update ON whatsapp_numbers;
CREATE POLICY whatsapp_numbers_update ON whatsapp_numbers FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS whatsapp_numbers_delete ON whatsapp_numbers;
CREATE POLICY whatsapp_numbers_delete ON whatsapp_numbers FOR DELETE
  USING (is_account_member(account_id, 'admin'));

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phone_number_id text;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS phone_number_id text;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_whatsapp_numbers integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_max_whatsapp_numbers_check
    CHECK (max_whatsapp_numbers BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only raise from the default, so a value set in the admin panel stays.
UPDATE plans SET max_whatsapp_numbers = 5
 WHERE id IN ('scale', 'pro') AND max_whatsapp_numbers = 1;

-- Per-account override (platform admin), NULL = follow the plan.
ALTER TABLE account_billing ADD COLUMN IF NOT EXISTS max_whatsapp_numbers_override integer;
DO $$ BEGIN
  ALTER TABLE account_billing ADD CONSTRAINT account_billing_max_numbers_override_check
    CHECK (max_whatsapp_numbers_override IS NULL OR max_whatsapp_numbers_override BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
