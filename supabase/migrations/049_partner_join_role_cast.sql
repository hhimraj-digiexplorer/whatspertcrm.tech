-- ============================================================
-- 049_partner_join_role_cast.sql
--
-- partner_join_account() wrote its text role into profiles.account_role,
-- which is account_role_enum, so every partner single sign-on that had
-- to create a new user failed ("Could not add you to the WhatsApp
-- workspace"). Cast the role. Idempotent.
-- ============================================================

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

  UPDATE profiles SET account_id = p_account_id, account_role = p_role::account_role_enum WHERE user_id = p_user_id;
  DELETE FROM accounts WHERE id = v_old_account;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.partner_join_account(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
