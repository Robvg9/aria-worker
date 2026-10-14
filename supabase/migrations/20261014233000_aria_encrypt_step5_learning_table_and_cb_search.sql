-- ARIA Encrypt Step 5 follow-up: explicitly classify internal learning records and close the legacy chunk-search RPC.
-- Existing learning rows are preserved as unclassified; this migration does not rewrite/delete their content.

BEGIN;

ALTER TABLE aria_internal.autonomy_learnings
  ADD COLUMN IF NOT EXISTS privacy_class text NOT NULL DEFAULT 'unclassified';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'aria_encrypt_autonomy_learnings_privacy_class_check'
       AND conrelid = 'aria_internal.autonomy_learnings'::regclass
  ) THEN
    ALTER TABLE aria_internal.autonomy_learnings
      ADD CONSTRAINT aria_encrypt_autonomy_learnings_privacy_class_check
      CHECK (privacy_class IN ('general', 'private', 'unclassified'));
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION aria_internal.aria_encrypt_require_general_learning()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
BEGIN
  IF NEW.privacy_class IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'learning_general_classification_required';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aria_encrypt_general_learning_guard
  ON aria_internal.autonomy_learnings;
CREATE TRIGGER aria_encrypt_general_learning_guard
BEFORE INSERT OR UPDATE OF summary, evidence, privacy_class
ON aria_internal.autonomy_learnings
FOR EACH ROW EXECUTE FUNCTION aria_internal.aria_encrypt_require_general_learning();

-- The table is internal; remove any accidental direct client table grants.
REVOKE ALL PRIVILEGES ON TABLE aria_internal.autonomy_learnings
  FROM PUBLIC, anon, authenticated;

-- Legacy helper is service-role-only, but it must also enforce the class predicate.
CREATE OR REPLACE FUNCTION public.cb_search_chunks(search_query text, result_limit integer DEFAULT 8)
RETURNS TABLE(
  chunk_id uuid,
  document_id uuid,
  title text,
  project text,
  status text,
  authority text,
  heading text,
  content text,
  rank real
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    c.id,
    c.document_id,
    d.title,
    d.project,
    d.status,
    d.authority,
    c.heading,
    c.content,
    ts_rank_cd(c.search_text, websearch_to_tsquery('simple', search_query))::real
  FROM public.cb_chunks c
  JOIN public.cb_documents d ON d.id = c.document_id
  WHERE c.search_text @@ websearch_to_tsquery('simple', search_query)
    AND d.metadata->>'privacy_class' = 'general'
  ORDER BY
    CASE WHEN d.status = 'vigente' THEN 0
         WHEN d.status = 'pendiente_revalidacion' THEN 1
         ELSE 2 END,
    CASE WHEN d.authority = 'fuente_primaria' THEN 0
         WHEN d.authority = 'artefacto_verificable' THEN 1
         WHEN d.authority = 'documentacion' THEN 2
         ELSE 3 END,
    ts_rank_cd(c.search_text, websearch_to_tsquery('simple', search_query)) DESC,
    d.verified_at DESC NULLS LAST
  LIMIT greatest(1, least(result_limit, 50));
$function$;

REVOKE EXECUTE ON FUNCTION public.cb_search_chunks(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_search_chunks(text, integer)
  TO service_role;

COMMIT;
