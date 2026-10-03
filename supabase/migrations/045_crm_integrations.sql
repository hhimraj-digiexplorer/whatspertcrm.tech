-- ============================================================
-- 045_crm_integrations.sql — DigiExplorer Real Expert CRM sync
--
-- An account can link its Whatspert workspace to a Real Expert CRM
-- workspace. Four syncs, each switchable:
--   - new WhatsApp contacts are created as leads in Real Expert;
--   - deal stage / status / value changes are pushed to the lead;
--   - every WhatsApp message is logged on the lead's timeline;
--   - Real Expert can POST new leads to us and we greet them on
--     WhatsApp with an approved template.
--
-- Tables
--   crm_integrations   one row per (account, provider). The API key
--                      and the inbound token are AES-256-GCM encrypted
--                      by the app (same encrypt() as access tokens).
--   crm_contact_links  which Real Expert lead a contact maps to.
--   crm_sync_queue     outbox. Triggers on contacts / deals / messages
--                      add a row when the matching sync is on; the app
--                      drains it after inbound/outbound messages, on a
--                      cron, and from "Sync now". Retries back off and
--                      give up after a few attempts.
--
-- Writes to Real Expert happen outside the database, so a slow or
-- broken CRM never blocks saving a message or moving a deal.
--
-- RLS: integrations are admin-only (they hold credentials); links are
-- readable by members; the queue is service-role only.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_integrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider           text NOT NULL DEFAULT 'real_expert',
  is_active          boolean NOT NULL DEFAULT true,
  base_url           text NOT NULL,
  api_key            text NOT NULL,          -- encrypted
  inbound_token      text NOT NULL,          -- encrypted; authenticates Real Expert -> us
  sync_new_leads     boolean NOT NULL DEFAULT true,
  sync_deals         boolean NOT NULL DEFAULT true,
  sync_messages      boolean NOT NULL DEFAULT false,
  inbound_enabled    boolean NOT NULL DEFAULT false,
  welcome_template_name     text,
  welcome_template_language text,
  -- Paths, auth header style, default country code. Validated in the app.
  options            jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at       timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_integrations_provider_check CHECK (provider IN ('real_expert')),
  CONSTRAINT crm_integrations_account_provider_key UNIQUE (account_id, provider)
);

ALTER TABLE crm_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_integrations_select ON crm_integrations;
CREATE POLICY crm_integrations_select ON crm_integrations FOR SELECT
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS crm_integrations_insert ON crm_integrations;
CREATE POLICY crm_integrations_insert ON crm_integrations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS crm_integrations_update ON crm_integrations;
CREATE POLICY crm_integrations_update ON crm_integrations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS crm_integrations_delete ON crm_integrations;
CREATE POLICY crm_integrations_delete ON crm_integrations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_contact_links (
  integration_id uuid NOT NULL REFERENCES crm_integrations(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id    text NOT NULL,
  -- 'whatspert' = we created the lead; 'real_expert' = it came from there.
  origin         text NOT NULL DEFAULT 'whatspert',
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, contact_id),
  CONSTRAINT crm_contact_links_origin_check CHECK (origin IN ('whatspert', 'real_expert'))
);

CREATE INDEX IF NOT EXISTS crm_contact_links_external_idx
  ON crm_contact_links (integration_id, external_id);

ALTER TABLE crm_contact_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_contact_links_select ON crm_contact_links;
CREATE POLICY crm_contact_links_select ON crm_contact_links FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_sync_queue (
  id              bigserial PRIMARY KEY,
  integration_id  uuid NOT NULL REFERENCES crm_integrations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  entity_id       uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_sync_queue_kind_check CHECK (kind IN ('lead', 'deal', 'message')),
  CONSTRAINT crm_sync_queue_status_check CHECK (status IN ('pending', 'running', 'done', 'failed'))
);

-- One pending job per entity: three quick stage moves become one push
-- of the latest state.
CREATE UNIQUE INDEX IF NOT EXISTS crm_sync_queue_pending_uniq
  ON crm_sync_queue (integration_id, kind, entity_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS crm_sync_queue_due_idx
  ON crm_sync_queue (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS crm_sync_queue_account_idx
  ON crm_sync_queue (account_id, status);

ALTER TABLE crm_sync_queue ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role touches the queue.

-- ------------------------------------------------------------
-- Enqueue helper + triggers
-- ------------------------------------------------------------
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
    WHERE account_id = p_account_id AND is_active
  LOOP
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

CREATE OR REPLACE FUNCTION public.crm_contacts_enqueue() RETURNS trigger AS $$
BEGIN
  PERFORM crm_enqueue(NEW.account_id, 'lead', NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.crm_deals_enqueue() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.stage_id IS DISTINCT FROM OLD.stage_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.value IS DISTINCT FROM OLD.value THEN
    PERFORM crm_enqueue(NEW.account_id, 'deal', NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.crm_messages_enqueue() RETURNS trigger AS $$
DECLARE
  acct uuid;
BEGIN
  SELECT account_id INTO acct FROM conversations WHERE id = NEW.conversation_id;
  PERFORM crm_enqueue(acct, 'message', NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.crm_contacts_enqueue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_deals_enqueue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_messages_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_contacts_enqueue ON contacts;
CREATE TRIGGER crm_contacts_enqueue AFTER INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.crm_contacts_enqueue();

DROP TRIGGER IF EXISTS crm_deals_enqueue ON deals;
CREATE TRIGGER crm_deals_enqueue AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.crm_deals_enqueue();

DROP TRIGGER IF EXISTS crm_messages_enqueue ON messages;
CREATE TRIGGER crm_messages_enqueue AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.crm_messages_enqueue();

-- ------------------------------------------------------------
-- Claim due jobs atomically so overlapping drains (cron + after())
-- never push the same job twice. A job stuck in 'running' for 10
-- minutes (crashed worker) is picked up again.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_claim_jobs(
  p_account_id uuid,
  p_limit int
) RETURNS SETOF crm_sync_queue AS $$
  UPDATE crm_sync_queue q
  SET status = 'running', attempts = q.attempts + 1, updated_at = now()
  WHERE q.id IN (
    SELECT id FROM crm_sync_queue
    WHERE (p_account_id IS NULL OR account_id = p_account_id)
      AND (
        (status = 'pending' AND next_attempt_at <= now())
        OR (status = 'running' AND updated_at < now() - interval '10 minutes')
      )
    ORDER BY id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.crm_claim_jobs(uuid, int) FROM PUBLIC, anon, authenticated;
