-- ============================================================
-- 055_projects_and_lead_webhooks.sql
--
-- Projects become a workspace feature of their own — no longer tied to
-- the Real Expert integration — so a channel partner selling villas,
-- commercial spaces and apartments from one WhatsApp number can route
-- every lead and message to the right project, whatever the lead
-- source (Real Expert, any other CRM, website forms, Meta lead ads via
-- Zapier / Make / Pabbly, Click-to-WhatsApp ads, a plain WhatsApp chat).
--
--   * projects — name, code, category, the project's tag (tags group
--     "Project"), how leads/messages are recognised (keywords, Meta ad
--     ids), its welcome template and AI notes.
--   * lead_webhooks — a private URL per lead source that any CRM,
--     website or automation tool can POST leads to.
--   * contacts.lead_meta — where the contact's latest lead came from
--     (source, campaign, ad, form, page, UTM).
--
-- Existing Real Expert project settings are copied into `projects`.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  code              text,
  category          text NOT NULL DEFAULT 'residential',
  tag               text NOT NULL,
  keywords          text[] NOT NULL DEFAULT '{}',
  ad_ids            text[] NOT NULL DEFAULT '{}',
  welcome_mode      text NOT NULL DEFAULT 'default',
  welcome_template  text,
  welcome_language  text,
  ai_instructions   text,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_category_check CHECK (category IN ('residential', 'villa', 'plot', 'commercial', 'mixed', 'other')),
  CONSTRAINT projects_welcome_mode_check CHECK (welcome_mode IN ('default', 'template', 'none'))
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_account_tag_uniq ON projects (account_id, lower(tag));
CREATE UNIQUE INDEX IF NOT EXISTS projects_account_code_uniq ON projects (account_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS projects_account_idx ON projects (account_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS lead_webhooks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  -- sha256 of the secret in the URL (lookup) + the secret encrypted
  -- with ENCRYPTION_KEY (so admins can copy the URL again).
  token_hash              text NOT NULL UNIQUE,
  token_enc               text NOT NULL,
  default_project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  tags                    text[] NOT NULL DEFAULT '{}',
  send_welcome            boolean NOT NULL DEFAULT true,
  welcome_template        text,
  welcome_language        text,
  default_country_code    text NOT NULL DEFAULT '91',
  is_active               boolean NOT NULL DEFAULT true,
  leads_received          integer NOT NULL DEFAULT 0,
  last_received_at        timestamptz,
  last_error              text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_webhooks_account_idx ON lead_webhooks (account_id);

ALTER TABLE lead_webhooks ENABLE ROW LEVEL SECURITY;
-- Admin-only, and only through the server (the secret never reaches
-- the browser except to the admin who opens the settings page).
DROP POLICY IF EXISTS lead_webhooks_select ON lead_webhooks;
CREATE POLICY lead_webhooks_select ON lead_webhooks FOR SELECT USING (is_account_member(account_id, 'admin'));

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_meta jsonb;

-- ------------------------------------------------------------
-- Copy Real Expert project settings (crm_integrations.options.projects,
-- migration 053/054) into projects. A project without a tag gets
-- "p-<key>". Ad entries that are all digits are Meta ad ids; the rest
-- become keywords. Existing rows (same tag) are left alone.
-- ------------------------------------------------------------
INSERT INTO projects (account_id, name, code, tag, keywords, ad_ids, welcome_mode, welcome_template, welcome_language)
SELECT
  ci.account_id,
  left(coalesce(nullif(p.value->>'name', ''), p.key), 120),
  nullif(p.value->>'code', ''),
  left(coalesce(nullif(p.value->>'tag', ''), 'p-' || p.key), 50),
  coalesce(ARRAY(
    SELECT a FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.value->'ads') = 'array' THEN p.value->'ads' ELSE '[]'::jsonb END) a
    WHERE a !~ '^[0-9]+$'
  ), '{}'),
  coalesce(ARRAY(
    SELECT a FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.value->'ads') = 'array' THEN p.value->'ads' ELSE '[]'::jsonb END) a
    WHERE a ~ '^[0-9]+$'
  ), '{}'),
  CASE
    WHEN p.value->>'welcome' = 'none' THEN 'none'
    WHEN jsonb_typeof(p.value->'welcome') = 'object' THEN 'template'
    ELSE 'default'
  END,
  CASE WHEN jsonb_typeof(p.value->'welcome') = 'object' THEN p.value->'welcome'->>'template' END,
  CASE WHEN jsonb_typeof(p.value->'welcome') = 'object' THEN p.value->'welcome'->>'language' END
FROM crm_integrations ci
CROSS JOIN LATERAL jsonb_each(
  CASE WHEN jsonb_typeof(ci.options->'projects') = 'object' THEN ci.options->'projects' ELSE '{}'::jsonb END
) p
WHERE ci.provider = 'real_expert'
  AND jsonb_typeof(p.value) = 'object'
ON CONFLICT DO NOTHING;
