-- ============================================================
-- 046_crm_deal_links.sql — Real Expert deal ids
--
-- Real Expert keeps deals as their own records (created once, then
-- updated by id), so each Whatspert deal remembers the Real Expert
-- deal it was pushed as.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_deal_links (
  integration_id uuid NOT NULL REFERENCES crm_integrations(id) ON DELETE CASCADE,
  deal_id        uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, deal_id)
);

ALTER TABLE crm_deal_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_deal_links_select ON crm_deal_links;
CREATE POLICY crm_deal_links_select ON crm_deal_links FOR SELECT
  USING (is_account_member(account_id));
