-- ARIA Encrypt Step 5: fail-closed boundaries for general retrieval, memory writes and RPC.
-- Existing unclassified rows are preserved, but are excluded from general retrieval until reviewed.
-- This migration deliberately does not move or delete user content.

BEGIN;

-- Remove accidental direct client privileges on the general-purpose ChatBending index.
REVOKE ALL PRIVILEGES ON TABLE
  public.cb_documents,
  public.cb_chunks,
  public.cb_memory_candidates,
  public.cb_retrieval_events
FROM PUBLIC, anon, authenticated;

-- Content-bearing RPCs must not be callable directly by anonymous/authenticated clients.
REVOKE EXECUTE ON FUNCTION public.cb_search_chunks(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_search_chunks(text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb_record_retrieval(text, uuid[], text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_record_retrieval(text, uuid[], text, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION aria_memory.learning_context_for_goal(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_memory.learning_context_for_goal(text, integer) TO service_role;

-- Staged memory candidates get an explicit class. Legacy writers omit the field and are rejected
-- by the trigger below until they are updated to send an explicit general-only classification.
ALTER TABLE public.cb_memory_candidates
  ADD COLUMN IF NOT EXISTS privacy_class text NOT NULL DEFAULT 'unclassified';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_memory_candidates_privacy_class_check'
      AND conrelid = 'public.cb_memory_candidates'::regclass
  ) THEN
    ALTER TABLE public.cb_memory_candidates
      ADD CONSTRAINT cb_memory_candidates_privacy_class_check
      CHECK (privacy_class IN ('general', 'private', 'unclassified'));
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.aria_encrypt_require_general_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF (coalesce(NEW.metadata, '{}'::jsonb)->>'privacy_class') IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'privacy_class_general_required';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aria_encrypt_general_document_guard ON public.cb_documents;
CREATE TRIGGER aria_encrypt_general_document_guard
BEFORE INSERT OR UPDATE OF title, source_id, canonical_url, metadata
ON public.cb_documents
FOR EACH ROW EXECUTE FUNCTION public.aria_encrypt_require_general_document();

CREATE OR REPLACE FUNCTION public.aria_encrypt_require_general_chunk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  document_class text;
BEGIN
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

DROP TRIGGER IF EXISTS aria_encrypt_general_chunk_guard ON public.cb_chunks;
CREATE TRIGGER aria_encrypt_general_chunk_guard
BEFORE INSERT OR UPDATE OF document_id, heading, content, metadata
ON public.cb_chunks
FOR EACH ROW EXECUTE FUNCTION public.aria_encrypt_require_general_chunk();

CREATE OR REPLACE FUNCTION public.aria_encrypt_require_general_candidate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.privacy_class IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate_general_classification_required';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aria_encrypt_general_candidate_guard ON public.cb_memory_candidates;
CREATE TRIGGER aria_encrypt_general_candidate_guard
BEFORE INSERT OR UPDATE OF candidate_text, privacy_class
ON public.cb_memory_candidates
FOR EACH ROW EXECUTE FUNCTION public.aria_encrypt_require_general_candidate();

-- Existing canonical memory rows remain intact. Unclassified/explicitly private rows do not pass
-- the general memory/search surface, and new writes/embeddings require an explicit general label.
CREATE OR REPLACE FUNCTION aria_memory.aria_encrypt_require_general_memory()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'aria_memory'
AS $function$
BEGIN
  IF (coalesce(NEW.metadata, '{}'::jsonb)->>'privacy_class') IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'memory_general_classification_required';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aria_encrypt_general_memory_guard ON aria_memory.memory_items;
CREATE TRIGGER aria_encrypt_general_memory_guard
BEFORE INSERT OR UPDATE OF title, content, metadata, embedding
ON aria_memory.memory_items
FOR EACH ROW EXECUTE FUNCTION aria_memory.aria_encrypt_require_general_memory();

-- Internal embedding workers may only enumerate already-reviewed general content.
CREATE OR REPLACE FUNCTION aria_memory.list_unembedded(p_limit integer DEFAULT 10)
RETURNS TABLE(memory_id uuid, title text, content text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_memory'
AS $function$
  SELECT m.memory_id, m.title, m.content
    FROM aria_memory.memory_items m
   WHERE m.embedding IS NULL
     AND m.status = 'active'
     AND m.metadata->>'privacy_class' = 'general'
   ORDER BY m.created_at ASC
   LIMIT greatest(1, least(coalesce(p_limit, 10), 20));
$function$;

CREATE OR REPLACE FUNCTION aria_memory.search_hybrid(
  p_query text,
  p_query_embedding extensions.vector DEFAULT NULL::extensions.vector,
  p_limit integer DEFAULT 12,
  p_lexical_weight numeric DEFAULT 0.55,
  p_semantic_weight numeric DEFAULT 0.45,
  p_rrf_k integer DEFAULT 50
)
RETURNS TABLE(memory_id uuid, memory_type text, title text, content text, confidence numeric, importance numeric, salience numeric, lexical_rank bigint, semantic_rank bigint, hybrid_score numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_memory', 'extensions'
AS $function$
WITH lexical AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY ts_rank_cd(m.search_tsv, websearch_to_tsquery('simple', p_query)) DESC, m.importance DESC, m.confidence DESC) AS rank_ix
    FROM aria_memory.memory_items m
   WHERE m.status = 'active'
     AND m.metadata->>'privacy_class' = 'general'
     AND m.search_tsv @@ websearch_to_tsquery('simple', p_query)
   LIMIT greatest(1, least(p_limit * 3, 100))
), semantic AS (
  SELECT m.memory_id,
         row_number() OVER (ORDER BY m.embedding <=> p_query_embedding ASC, m.importance DESC, m.confidence DESC) AS rank_ix
    FROM aria_memory.memory_items m
   WHERE p_query_embedding IS NOT NULL
     AND m.status = 'active'
     AND m.metadata->>'privacy_class' = 'general'
     AND m.embedding IS NOT NULL
   ORDER BY m.embedding <=> p_query_embedding ASC
   LIMIT greatest(1, least(p_limit * 3, 100))
), all_hits AS (
  SELECT coalesce(l.memory_id, s.memory_id) AS memory_id,
         l.rank_ix AS lexical_rank, s.rank_ix AS semantic_rank
    FROM lexical l FULL OUTER JOIN semantic s USING (memory_id)
)
SELECT m.memory_id, m.memory_type, m.title, m.content, m.confidence, m.importance, m.salience,
       h.lexical_rank, h.semantic_rank,
       (coalesce(p_lexical_weight * (1.0 / (p_rrf_k + h.lexical_rank)), 0)
       + coalesce(p_semantic_weight * (1.0 / (p_rrf_k + h.semantic_rank)), 0))
       * (0.50 + 0.25 * m.confidence + 0.15 * m.importance + 0.10 * m.salience) AS hybrid_score
  FROM all_hits h JOIN aria_memory.memory_items m ON m.memory_id = h.memory_id
 WHERE m.status = 'active'
   AND m.metadata->>'privacy_class' = 'general'
 ORDER BY hybrid_score DESC, m.updated_at DESC
 LIMIT greatest(1, least(p_limit, 100));
$function$;

CREATE OR REPLACE FUNCTION aria_memory.search_lexical(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE(memory_id uuid, memory_type text, title text, content text, confidence numeric, importance numeric, salience numeric, rank real)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT m.memory_id, m.memory_type, m.title, m.content, m.confidence, m.importance, m.salience,
       ts_rank(m.search_tsv, websearch_to_tsquery('simple', p_query))
  FROM aria_memory.memory_items m
 WHERE m.status = 'active'
   AND m.metadata->>'privacy_class' = 'general'
   AND m.search_tsv @@ websearch_to_tsquery('simple', p_query)
 ORDER BY 8 DESC, m.confidence DESC, m.importance DESC
 LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
$function$;

CREATE OR REPLACE FUNCTION aria_memory.search_hybrid_user_scoped(
  p_user_id uuid,
  p_query text,
  p_query_embedding extensions.vector DEFAULT NULL::extensions.vector,
  p_limit integer DEFAULT 12,
  p_lexical_weight numeric DEFAULT 0.55,
  p_semantic_weight numeric DEFAULT 0.45,
  p_rrf_k integer DEFAULT 50
)
RETURNS TABLE(memory_id uuid, memory_type text, title text, content text, confidence numeric, importance numeric, salience numeric, hybrid_score numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_memory', 'extensions'
AS $function$
WITH lexical AS (
  SELECT m.memory_id, row_number() OVER (ORDER BY ts_rank_cd(m.search_tsv, websearch_to_tsquery('simple', p_query)) DESC, m.importance DESC, m.confidence DESC) AS rank_ix
    FROM aria_memory.memory_items m
   WHERE m.status='active' AND m.owner_user_id=p_user_id
     AND m.metadata->>'privacy_class'='general'
     AND m.search_tsv @@ websearch_to_tsquery('simple',p_query)
   LIMIT greatest(1,least(p_limit*3,100))
), semantic AS (
  SELECT m.memory_id, row_number() OVER (ORDER BY m.embedding <=> p_query_embedding ASC, m.importance DESC, m.confidence DESC) AS rank_ix
    FROM aria_memory.memory_items m
   WHERE p_query_embedding IS NOT NULL AND m.status='active' AND m.owner_user_id=p_user_id
     AND m.metadata->>'privacy_class'='general' AND m.embedding IS NOT NULL
   ORDER BY m.embedding <=> p_query_embedding ASC
   LIMIT greatest(1,least(p_limit*3,100))
), all_hits AS (
  SELECT coalesce(l.memory_id,s.memory_id) AS memory_id,l.rank_ix AS lexical_rank,s.rank_ix AS semantic_rank
    FROM lexical l FULL OUTER JOIN semantic s USING(memory_id)
)
SELECT m.memory_id,m.memory_type,m.title,m.content,m.confidence,m.importance,m.salience,
       (coalesce(p_lexical_weight*(1.0/(p_rrf_k+h.lexical_rank)),0)+coalesce(p_semantic_weight*(1.0/(p_rrf_k+h.semantic_rank)),0))
       *(0.50+0.25*m.confidence+0.15*m.importance+0.10*m.salience) AS hybrid_score
  FROM all_hits h JOIN aria_memory.memory_items m ON m.memory_id=h.memory_id
 WHERE m.status='active' AND m.owner_user_id=p_user_id AND m.metadata->>'privacy_class'='general'
 ORDER BY hybrid_score DESC,m.updated_at DESC
 LIMIT greatest(1,least(p_limit,100));
$function$;

CREATE OR REPLACE FUNCTION aria_memory.learning_context_for_goal(p_goal text, p_limit integer DEFAULT 12)
RETURNS TABLE(memory_id uuid, memory_type text, title text, content text, status text, confidence numeric, metadata jsonb, source_ref text, application_required boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_memory'
AS $function$
WITH q AS (SELECT lower(trim(coalesce(p_goal,''))) AS goal)
SELECT m.memory_id, m.memory_type, m.title, m.content, m.status, m.confidence, m.metadata, m.source_ref,
       (m.status='active' AND (coalesce(m.metadata->>'preflight_required','false')='true'
        OR coalesce(m.metadata->>'learning_kind','')='failure_prevention')) AS application_required
  FROM aria_memory.memory_items m, q
 WHERE m.status IN ('active','candidate')
   AND m.metadata->>'privacy_class'='general'
   AND m.memory_type IN ('skill','lesson','procedural','semantic')
   AND (
     m.search_tsv @@ websearch_to_tsquery('simple', regexp_replace(q.goal,'[^[:alnum:]_ -]',' ','g'))
     OR position(q.goal in lower(coalesce(m.content,''))) > 0
     OR position(q.goal in lower(coalesce(m.title,''))) > 0
     OR lower(coalesce(m.metadata->>'scope','')) LIKE '%supabase_edge_functions%'
     OR (
       lower(coalesce(m.metadata->>'learning_kind',''))='failure_prevention'
       AND (
         lower(coalesce(m.title,'')) LIKE '%' || lower(trim(coalesce(p_goal,''))) || '%'
         OR lower(coalesce(m.metadata->>'scope','')) LIKE '%' || lower(trim(coalesce(p_goal,''))) || '%'
         OR EXISTS (
           SELECT 1 FROM regexp_split_to_table(lower(trim(coalesce(p_goal,''))), '[[:space:]]+') AS token(value)
            WHERE length(value) >= 5 AND position(value in lower(coalesce(m.metadata->>'scope',''))) > 0
         )
       )
     )
   )
 ORDER BY CASE WHEN m.status='active' THEN 0 ELSE 1 END,
          CASE WHEN (coalesce(m.metadata->>'preflight_required','false')='true' OR coalesce(m.metadata->>'learning_kind','')='failure_prevention') THEN 0 ELSE 1 END,
          m.confidence DESC, m.importance DESC, m.updated_at DESC
 LIMIT greatest(1, least(coalesce(p_limit,12),50));
$function$;

-- Replace raw query retention with a fixed redaction marker and a small metadata allowlist.
CREATE OR REPLACE FUNCTION public.cb_record_retrieval(
  query_text text,
  chunk_ids uuid[],
  model_name text DEFAULT NULL::text,
  extra_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  event_id uuid;
  safe_metadata jsonb;
  requester text;
BEGIN
  requester := coalesce(extra_metadata->>'requester_user_id', '');
  safe_metadata := jsonb_build_object(
    'source', left(coalesce(extra_metadata->>'source', 'unknown'), 64),
    'transport', left(coalesce(extra_metadata->>'transport', 'unknown'), 32),
    'result_count', coalesce(array_length(chunk_ids, 1), 0)
  );
  IF requester ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    safe_metadata := safe_metadata || jsonb_build_object('requester_user_id', requester);
  END IF;
  INSERT INTO public.cb_retrieval_events(query, selected_chunk_ids, result_count, model, metadata)
  VALUES ('[REDACTED: query content not retained]', coalesce(chunk_ids, '{}'::uuid[]),
          coalesce(array_length(chunk_ids, 1), 0), left(coalesce(model_name, 'unknown'), 64), safe_metadata)
  RETURNING id INTO event_id;
  RETURN event_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cb_search_chunks(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_search_chunks(text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb_record_retrieval(text, uuid[], text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_record_retrieval(text, uuid[], text, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION aria_memory.learning_context_for_goal(text, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.cb_documents IS
  'Shared retrieval index: every new/updated indexed document must be explicitly classified privacy_class=general; private or unclassified source text belongs outside this index.';
COMMENT ON COLUMN public.cb_memory_candidates.privacy_class IS
  'Only explicitly general candidates are accepted. Private or unclassified candidate text must not be staged in the shared memory pipeline.';

COMMIT;
