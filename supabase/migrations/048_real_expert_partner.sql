-- ============================================================
-- 048_real_expert_partner.sql — Whatspert inside Real Expert CRM
--
-- Real Expert CRM sells WhatsApp (Whatspert) as an add-on. Real Expert
-- links each of its client workspaces to a Whatspert account through
-- the signed partner API (/api/partner/real-expert/*); the link is the
-- account's crm_integrations row, now carrying:
--
--   partner_ref         Real Expert's id for the workspace ("re:<host>:<tenant id>")
--   partner_crm_active  Real Expert says the client's CRM subscription is paid
--   partner_crm_plan    its plan name, for display
--
-- The integration only works when the client has paid for BOTH:
-- partner_crm_active AND a paid (non-trial, non-expired) Whatspert
-- plan. `crm_integration_entitled()` is that rule; the sync triggers
-- stop queueing when it is false, and the app checks it on every
-- partner call, the inbound webhook and the sync worker.
--
-- `partner_join_account()` moves a freshly created user into the
-- linked account, so Real Expert users can sign in to Whatspert with
-- single sign-on. Service role only.
--
-- Idempotent.
-- ============================================================

ALTER TABLE crm_integrations
  ADD COLUMN IF NOT EXISTS partner_ref text,
  ADD COLUMN IF NOT EXISTS partner_crm_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_crm_plan text,
  ADD COLUMN IF NOT EXISTS partner_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS crm_integrations_partner_ref_key
  ON crm_integrations (partner_ref) WHERE partner_ref IS NOT NULL;

-- ------------------------------------------------------------
-- Has the account paid for WhatsApp? A paid plan that is active, or
-- cancelled/past due but still inside its period (past due gets the
-- same 7-day grace as the app). Trials and suspended accounts do not
-- count.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_whatsapp_paid(p_account_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM account_billing b
    JOIN plans p ON p.id = b.plan_id
    WHERE b.account_id = p_account_id
      AND b.suspended_at IS NULL
      AND NOT p.is_trial
      AND (
        (b.status = 'active' AND (b.current_period_end IS NULL OR b.current_period_end > now()))
        OR (b.status = 'cancelled' AND b.current_period_end > now())
        OR (b.status = 'past_due' AND b.current_period_end > now() - interval '7 days')
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.crm_integration_entitled(p_integration_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM crm_integrations i
    WHERE i.id = p_integration_id
      AND i.partner_ref IS NOT NULL
      AND i.partner_crm_active
      AND crm_whatsapp_paid(i.account_id)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.crm_whatsapp_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_integration_entitled(uuid) FROM PUBLIC, anon, authenticated;

-- Queue sync jobs only for entitled integrations.
CREATE OR REPLACE FUNCTION public.crm_enqueue(
  p_account_id uuid,
  p_kind text,
  p_entity_id uuid
) RETURNS void AS $$
DECLARE
  integ crm_integrations%ROWTYPE;
BEGIN
  IF p_account_id IS NULL THEN
    RETURN;
  END IF;
  FOR integ IN
    SELECT * FROM crm_integrations
    WHERE account_id = p_account_id
      AND is_active
      AND partner_ref IS NOT NULL
      AND partner_crm_active
  LOOP
    IF NOT crm_whatsapp_paid(p_account_id) THEN
      RETURN;
    END IF;
    IF (p_kind = 'lead' AND integ.sync_new_leads)
       OR (p_kind = 'deal' AND integ.sync_deals)
       OR (p_kind = 'message' AND integ.sync_messages) THEN
      INSERT INTO crm_sync_queue (integration_id, account_id, kind, entity_id)
      VALUES (integ.id, p_account_id, p_kind, p_entity_id)
      ON CONFLICT (integration_id, kind, entity_id) WHERE status = 'pending'
      DO UPDATE SET updated_at = now();
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.crm_enqueue(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Move a user into the linked account (single sign-on from Real
-- Expert). Same safety rules as redeem_invitation: the user's current
-- account must be their own, empty, personal account, which is then
-- removed. No-op when they are already a member.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_join_account(
  p_user_id uuid,
  p_account_id uuid,
  p_role text
) RETURNS void AS $$
DECLARE
  v_old_account uuid;
  v_old_owner uuid;
  v_has_data boolean;
BEGIN
  IF p_role NOT IN ('admin', 'agent', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id INTO v_old_account, v_old_owner
  FROM profiles p JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = p_user_id;

  IF v_old_account IS NULL THEN
    RAISE EXCEPTION 'User has no profile' USING ERRCODE = '42501';
  END IF;
  IF v_old_account = p_account_id THEN
    RETURN;
  END IF;
  IF v_old_owner <> p_user_id THEN
    RAISE EXCEPTION 'User already belongs to another shared account' USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account
    LIMIT 1
  ) INTO v_has_data;
  IF v_has_data THEN
    RAISE EXCEPTION 'User already has their own Whatspert data' USING ERRCODE = '23505';
  END IF;

  UPDATE profiles SET account_id = p_account_id, account_role = p_role WHERE user_id = p_user_id;
  DELETE FROM accounts WHERE id = v_old_account;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.partner_join_account(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- One-time link codes. An existing Whatspert customer who also buys
-- Real Expert creates a code in Whatspert (Integrations) and pastes it
-- into Real Expert, which proves the two accounts belong together.
-- Stored hashed; valid for 30 minutes; service role only.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_link_codes (
  code_hash  text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_link_codes_account_idx ON partner_link_codes (account_id);
ALTER TABLE partner_link_codes ENABLE ROW LEVEL SECURITY;
