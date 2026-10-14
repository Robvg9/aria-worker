-- ARIA Encrypt Step 5 follow-up: every indexed chunk must be independently reviewed as general.
-- This is fail-closed: historical chunk metadata is preserved and remains excluded until reviewed.

BEGIN;

CREATE OR REPLACE FUNCTION public.aria_encrypt_require_general_chunk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  document_class text;
BEGIN
  IF (coalesce(NEW.metadata, '{}'::jsonb)->>'privacy_class') IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chunk_general_classification_required';
  END IF;

  SELECT d.metadata->>'privacy_class'
    INTO document_class
    FROM public.cb_documents d
   WHERE d.id = NEW.document_id;

  IF document_class IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'parent_document_not_classified_general';
  END IF;

  RETURN NEW;
END;
$function$;

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
    AND c.metadata->>'privacy_class' = 'general'
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
