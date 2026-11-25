-- ============================================================
-- 056_crm_enquiries.sql
--
-- Real Expert sends one push per enquiry (lead_id + enquiry_id +
-- project). We remember the enquiry id per contact and project tag, so
-- messages and stage changes we sync back name the enquiry they belong
-- to — a buyer interested in three projects has three enquiries.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_enquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  uuid NOT NULL REFERENCES crm_integrations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_tag     text NOT NULL DEFAULT '',
  project_code    text,
  enquiry_id      text NOT NULL,
  lead_id         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One enquiry per contact and project ('' = no project) per integration;
-- a newer push for the same project replaces the id.
CREATE UNIQUE INDEX IF NOT EXISTS crm_enquiries_contact_project_uniq
  ON crm_enquiries (integration_id, contact_id, lower(project_tag));
CREATE INDEX IF NOT EXISTS crm_enquiries_contact_idx ON crm_enquiries (contact_id);

ALTER TABLE crm_enquiries ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role reads and writes enquiries.
