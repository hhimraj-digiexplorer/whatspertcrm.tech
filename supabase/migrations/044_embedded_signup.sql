-- ============================================================
-- 044_embedded_signup.sql — WhatsApp Embedded Signup (Tech Provider)
--
-- Clients can now connect their number through Meta's Embedded Signup
-- popup instead of pasting ids and a token. Two columns record how a
-- number was connected and the two-step verification PIN we set when
-- registering it (encrypted with ENCRYPTION_KEY, like access tokens),
-- so it can be re-registered later without asking the client.
--
-- Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS onboarding_method TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS two_step_pin TEXT;

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_onboarding_method_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_onboarding_method_check
  CHECK (onboarding_method IN ('manual', 'embedded', 'coexistence'));
