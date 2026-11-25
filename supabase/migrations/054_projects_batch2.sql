-- ============================================================
-- 054_projects_batch2.sql
--
-- Channel partners, part 2 (multi-project accounts):
--
--   * tags.group_name — tags can sit in a group ("Project"), so
--     automations and flows can test "has any / one / more than one
--     tag in the group" without one condition per pair of projects.
--   * contacts.ad_referral — the Click-to-WhatsApp ad a contact came
--     from (ad id, headline, source URL), saved from their message.
--   * ai_knowledge_documents.project_tag — a knowledge document can
--     belong to one project; the AI agent then only reads the shared
--     documents plus the contact's own project. New *_scoped match
--     functions do the filtering; the old ones are unchanged.
--   * ai_configs.project_scope / project_handoff — the AI agent's
--     per-project mode.
--   * automation_pending_executions.wait_step_id — the Wait step a
--     contact is waiting on, so an edited automation resumes them
--     right after that step instead of by position.
--   * crm_sync_queue: new kind 'enquiry' (a WhatsApp contact enquiring
--     about another project) with a payload column.
--
-- Idempotent. Nothing existing is moved or rewritten.
-- ============================================================

ALTER TABLE tags ADD COLUMN IF NOT EXISTS group_name text;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_referral jsonb;

ALTER TABLE ai_knowledge_documents ADD COLUMN IF NOT EXISTS project_tag text;

-- AI agent per project: answer only about the contact's project tag
-- (tags in the "Project" group), and optionally hand off to a person
-- when the contact has no project tag or more than one.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS project_scope boolean NOT NULL DEFAULT false;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS project_handoff boolean NOT NULL DEFAULT false;

ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS wait_step_id uuid REFERENCES automation_steps(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_automation_pending_wait_step
  ON automation_pending_executions(wait_step_id) WHERE status = 'pending';

ALTER TABLE crm_sync_queue ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE crm_sync_queue DROP CONSTRAINT IF EXISTS crm_sync_queue_kind_check;
ALTER TABLE crm_sync_queue ADD CONSTRAINT crm_sync_queue_kind_check
  CHECK (kind IN ('lead', 'deal', 'message', 'enquiry'));

-- ------------------------------------------------------------
-- Project-scoped knowledge retrieval. p_projects NULL = every
-- document; an array = shared documents (no project) plus those
-- whose project_tag is in the array (case-insensitive). An empty
-- array = shared documents only. SECURITY INVOKER like migration 032.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts_scoped(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer,
  p_projects    text[]
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_documents d ON d.id = c.document_id
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
    AND (
      p_projects IS NULL
      OR d.project_tag IS NULL
      OR lower(d.project_tag) = ANY (SELECT lower(x) FROM unnest(p_projects) AS x)
    )
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic_scoped(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer,
  p_projects        text[]
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_documents d ON d.id = c.document_id
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
    AND (
      p_projects IS NULL
      OR d.project_tag IS NULL
      OR lower(d.project_tag) = ANY (SELECT lower(x) FROM unnest(p_projects) AS x)
    )
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts_scoped(uuid, text, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts_scoped(uuid, text, integer, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic_scoped(uuid, text, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic_scoped(uuid, text, integer, text[]) TO authenticated, service_role;
