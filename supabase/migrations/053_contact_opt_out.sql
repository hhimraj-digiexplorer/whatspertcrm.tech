-- ============================================================
-- 053_contact_opt_out.sql
--
-- Built-in WhatsApp opt-out. A customer who sends STOP (or a similar
-- word) is marked opted out before any flow sees the message, and from
-- then on no automatic message goes to them — automations, flows, the
-- AI agent and broadcasts all check this column. Sending START clears
-- it. Agents can still reply by hand from the inbox.
--
-- Idempotent.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
-- What did it: 'keyword' (customer sent STOP), 'agent', 'api', 'import'.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_out_source text;

CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts(account_id)
  WHERE opted_out_at IS NOT NULL;
