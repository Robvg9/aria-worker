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

-- Additional internal-memory consumers must not re-expose or transform unclassified rows.

-- Mission-derived memory capture is skipped unless the source mission is explicitly general.

CREATE OR REPLACE FUNCTION aria_memory.capture_mission_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_content text; v_hash text; v_id uuid; v_entity uuid; v_failure_detail text; v_strategy text;
begin
 if tg_op <> 'UPDATE' then return new; end if;
 if new.status not in ('succeeded','failed','cancelled') or new.status=old.status then return new; end if;
 if coalesce(new.metadata->>'privacy_class','') IS DISTINCT FROM 'general' then return new; end if;
 if coalesce(new.metadata->>'structural_dedupe','false')='true' then return new; end if;
 v_entity := aria_memory.upsert_world_entity('mission',new.mission_id,'inactive',jsonb_build_object('goal',new.goal,'status',new.status,'completed_steps',new.completed_steps,'total_steps',new.total_steps,'recovery_count',new.recovery_count,'current_agent_id',new.current_agent_id),case when new.status='succeeded' then 1 else .85 end,new.mission_id,jsonb_build_object('capture','mission_state_trigger'));
 v_failure_detail := case when new.status='failed' then regexp_replace(left(coalesce(new.last_stderr,''),1200),'(?i)(bearer\\s+)[A-Za-z0-9._~+/=-]+|((?:api[_ -]?key|token|secret|password)[^:=]{0,30}[:=]\\s*)[^,;\\n]+','\\1[REDACTED]\\2[REDACTED]','g') else '' end;
 v_strategy := coalesce(new.checkpoint->'recovery'->>'next_strategy',''); v_content := 'Mission '||new.mission_id||' finished with status='||new.status||'. Goal='||coalesce(new.goal,'')||'. Completed steps='||coalesce(new.completed_steps,0)::text||'/'||coalesce(new.total_steps,0)::text||'. Exit code='||coalesce(new.last_exit_code::text,'null')||'. Next action='||coalesce(new.next_action,'')||'.';
 if v_failure_detail <> '' then v_content := v_content || ' Failure detail=' || v_failure_detail || '.'; end if; if v_strategy <> '' then v_content := v_content || ' Next strategy=' || left(v_strategy,600) || '.'; end if;
 v_hash := encode(extensions.digest(v_content,'sha256'),'hex');
 insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience) values('episodic','Mission outcome '||new.mission_id,v_content,v_hash,'mission',new.mission_id,jsonb_build_object('capture','mission_state_trigger','status',new.status,'mission_id',new.mission_id),jsonb_build_object('goal',new.goal,'status',new.status,'completed_steps',new.completed_steps,'total_steps',new.total_steps,'recovery_count',new.recovery_count,'exit_code',new.last_exit_code,'failure_detail',case when v_failure_detail<>'' then v_failure_detail else null end,'next_strategy',case when v_strategy<>'' then v_strategy else null end,'world_entity_id',v_entity,'privacy_class','general'),case when new.status='succeeded' then 1 else .85 end,.8,.9) on conflict(content_hash) do update set updated_at=now() returning memory_id into v_id;
 insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload) values(v_id,'created',new.mission_id,jsonb_build_object('trigger','mission_state','status',new.status,'world_entity_id',v_entity)); perform aria_memory.reflect_mission_outcome(v_id,new.mission_id,new.status,new.goal,new.completed_steps,new.total_steps,new.recovery_count); return new;
end;
$function$


CREATE OR REPLACE FUNCTION aria_memory.reflect_mission_outcome(p_memory_id uuid, p_mission_id text, p_status text, p_goal text, p_completed_steps integer, p_total_steps integer, p_recovery_count integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_content text;
  v_hash text;
  v_lesson uuid;
  v_confidence numeric;
  v_detail text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aria_memory.memory_items m WHERE m.memory_id=p_memory_id AND m.metadata->>'privacy_class'='general') THEN RETURN NULL; END IF; SELECT left(coalesce(m.content,''),1800) INTO v_detail FROM aria_memory.memory_items m WHERE m.memory_id=p_memory_id;
  IF p_status='succeeded' THEN
    v_content := 'Reflection: mission '||p_mission_id||' succeeded. Reusable pattern candidate: complete '||coalesce(p_completed_steps,0)::text||' of '||coalesce(p_total_steps,0)::text||' steps for goal '||coalesce(p_goal,'')||'. Recovery count='||coalesce(p_recovery_count,0)::text||'.';
    v_confidence := .95;
  ELSIF p_status='failed' THEN
    v_content := 'Reflection: mission '||p_mission_id||' failed. Failure pattern candidate for future planning. Goal='||coalesce(p_goal,'')||'. Completed '||coalesce(p_completed_steps,0)::text||' of '||coalesce(p_total_steps,0)::text||' steps. Recovery count='||coalesce(p_recovery_count,0)::text||'. Known failure evidence='||v_detail||'.';
    v_confidence := .85;
  ELSE
    v_content := 'Reflection: mission '||p_mission_id||' ended with status='||p_status||'. Treat as contextual experience, not a verified success.';
    v_confidence := .70;
  END IF;
  v_hash := encode(extensions.digest(v_content,'sha256'),'hex');
  INSERT INTO aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience)
  VALUES('lesson','Reflection for mission '||p_mission_id,v_content,v_hash,'mission',p_mission_id,jsonb_build_object('engine','reflection-v2','derived_from_memory_id',p_memory_id,'status',p_status),jsonb_build_object('mission_id',p_mission_id,'status',p_status,'completed_steps',p_completed_steps,'total_steps',p_total_steps,'recovery_count',p_recovery_count,'goal',coalesce(p_goal,''),'reusable_candidate',p_status='succeeded','failure_pattern',p_status='failed','privacy_class','general'),v_confidence,case when p_status='succeeded' then .9 else .8 end,.9)
  ON CONFLICT(content_hash) DO UPDATE SET updated_at=now()
  RETURNING memory_id INTO v_lesson;
  INSERT INTO aria_memory.memory_relations(from_memory_id,to_memory_id,relation_type,strength,provenance) VALUES(v_lesson,p_memory_id,'derived_from',v_confidence,jsonb_build_object('engine','reflection-v2')) ON CONFLICT(from_memory_id,to_memory_id,relation_type) DO NOTHING;
  INSERT INTO aria_memory.memory_events(memory_id,event_type,source_ref,payload) VALUES(v_lesson,'created',p_mission_id,jsonb_build_object('reflection','v2','source_memory_id',p_memory_id,'status',p_status));
  IF p_status='succeeded' THEN PERFORM aria_memory.compile_skill_for_goal(coalesce(p_goal,'')); END IF;
  RETURN v_lesson;
END;
$function$


CREATE OR REPLACE FUNCTION aria_memory.compile_skill_for_goal(p_goal text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_id uuid; v_count integer; v_content text; v_hash text; begin if p_goal is null or length(trim(p_goal))=0 then raise exception 'goal_required'; end if; select count(*) into v_count from aria_memory.memory_items where memory_type='lesson' and status='active' and metadata->>'reusable_candidate'='true' and metadata->>'goal'=p_goal and metadata->>'privacy_class'='general' and confidence >= .9; if v_count < 3 then return null; end if; v_content := 'Procedural skill compiled from '||v_count::text||' verified successful mission reflections for goal: '||trim(p_goal)||'. Reuse the validated mission pattern, preserve governance, verify each result, and replan when observations diverge.'; v_hash := encode(extensions.digest(v_content,'sha256'),'hex'); insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience) values('skill','Compiled skill: '||left(trim(p_goal),160),v_content,v_hash,'aria',null,jsonb_build_object('compiler','skill-compiler-v1','evidence_count',v_count),jsonb_build_object('goal',trim(p_goal),'evidence_count',v_count,'compiled',true,'version','v1','privacy_class','general'),least(.99,.75 + v_count*.05),.95,.95) on conflict(content_hash) do update set confidence=least(0.99,0.75+v_count*.05),metadata=jsonb_set(aria_memory.memory_items.metadata,'{evidence_count}',to_jsonb(v_count),true),updated_at=now() where aria_memory.memory_items.metadata->>'privacy_class'='general' returning memory_id into v_id; if v_id is null then return null; end if; insert into aria_memory.memory_events(memory_id,event_type,payload) values(v_id,'promoted',jsonb_build_object('compiler','skill-compiler-v1','evidence_count',v_count,'goal',p_goal)); insert into aria_memory.memory_relations(from_memory_id,to_memory_id,relation_type,strength,provenance) select v_id,m.memory_id,'implements',m.confidence,jsonb_build_object('compiler','skill-compiler-v1') from aria_memory.memory_items m where m.memory_type='lesson' and m.status='active' and m.metadata->>'reusable_candidate'='true' and m.metadata->>'goal'=p_goal and m.metadata->>'privacy_class'='general' and m.confidence>=.9 on conflict(from_memory_id,to_memory_id,relation_type) do nothing; return v_id; end; $function$


CREATE OR REPLACE FUNCTION aria_memory.promote_failure_learning(p_memory_id uuid, p_mission_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_memory', 'extensions'
AS $function$
declare
  v_mem aria_memory.memory_items%rowtype;
  v_terms jsonb;
  v_test_id text;
  v_regression jsonb;
begin
  select * into v_mem
  from aria_memory.memory_items
  where memory_id=p_memory_id
    and status='candidate'
    and coalesce(metadata->>'learning_kind','')='failure_prevention'
    and metadata->>'privacy_class'='general';

  if not found then
    return jsonb_build_object('promoted',false,'reason','candidate_not_found');
  end if;

  v_terms := coalesce(v_mem.metadata->'preflight_requirements'->'terms','[]'::jsonb);
  if jsonb_array_length(v_terms)=0 then
    v_terms := jsonb_build_array('verify');
  end if;

  v_test_id := 'failure-prevention-regression-' || substring(encode(extensions.digest(coalesce(v_mem.content_hash,v_mem.memory_id::text),'sha256'),'hex') from 1 for 16);
  v_regression := jsonb_build_object(
    'test_id',v_test_id,
    'status','active',
    'source_memory_id',p_memory_id,
    'source_mission_id',p_mission_id,
    'assertions',jsonb_build_array(
      jsonb_build_object('type','preflight_terms_required','terms',v_terms),
      jsonb_build_object('type','previous_strategy_not_repeated_without_new_evidence', 'required',true),
      jsonb_build_object('type','post_action_verification_required','required',true)
    ),
    'created_at',clock_timestamp()
  );

  update aria_memory.memory_items
  set
    status='active',
    confidence=greatest(confidence,.95),
    metadata = metadata
      || jsonb_build_object(
        'preflight_required',true,
        'activation_status','verified',
        'verified_by_mission',p_mission_id,
        'promoted_at',clock_timestamp(),
        'regression',v_regression
      ),
    updated_at=now()
  where memory_id=p_memory_id;

  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
  values(
    p_memory_id,
    'promoted',
    p_mission_id,
    jsonb_build_object('learning_kind','failure_prevention','regression',v_regression)
  );

  insert into aria_memory.memory_items(
    memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience
  )
  values(
    'procedural',
    'Regression contract: ' || left(v_mem.title,140),
    'Regression contract generated from verified failure-prevention learning. Future plans must satisfy the recorded preflight requirements, avoid repeating the previous failed strategy without new evidence, and verify the real post-action result.',
    encode(extensions.digest(v_test_id || '|' || coalesce(v_mem.content,''),'sha256'),'hex'),
    'aria',
    p_mission_id,
    jsonb_build_object('compiler','failure-prevention-mastery-v1','source_memory_id',p_memory_id),
    jsonb_build_object('regression',v_regression,'learning_kind','regression_contract','privacy_class','general'),
    .95,.95,.95
  )
  on conflict(content_hash) do update
    set updated_at=now(), metadata=excluded.metadata, confidence=.95, status='active', content=excluded.content;

  insert into aria_memory.memory_relations(from_memory_id,to_memory_id,relation_type,strength,provenance)
  select
    r.memory_id,
    p_memory_id,
    'implements',
    .95,
    jsonb_build_object('compiler','failure-prevention-mastery-v1')
  from aria_memory.memory_items r
  where r.content_hash = encode(extensions.digest(v_test_id || '|' || coalesce(v_mem.content,''),'sha256'),'hex')
  on conflict(from_memory_id,to_memory_id,relation_type) do nothing;

  return jsonb_build_object(
    'promoted',true,
    'memory_id',p_memory_id,
    'mission_id',p_mission_id,
    'regression',v_regression
  );
end;
$function$


CREATE OR REPLACE FUNCTION aria_memory.learning_preflight(p_goal text, p_plan jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_items jsonb; v_hits jsonb; v_count integer; begin if p_goal is null or length(trim(p_goal))=0 then raise exception 'goal_required'; end if; select coalesce(jsonb_agg(jsonb_build_object('memory_id',m.memory_id,'title',m.title,'content',left(m.content,2000),'confidence',m.confidence,'metadata',m.metadata) order by m.confidence desc,m.salience desc,m.updated_at desc),'[]'::jsonb), count(*) into v_hits,v_count from aria_memory.memory_items m where m.status='active' and m.memory_type in ('skill','lesson','episodic') and (m.subject ilike '%'||trim(p_goal)||'%' or m.title ilike '%'||trim(p_goal)||'%' or m.content ilike '%'||trim(p_goal)||'%') and m.metadata->>'privacy_class'='general' and m.confidence >= .80 limit 8; return jsonb_build_object('ok',true,'goal',trim(p_goal),'matched_count',coalesce(v_count,0),'matches',coalesce(v_hits,'[]'::jsonb),'preflight_required',true); end; $function$


CREATE OR REPLACE FUNCTION aria_memory.consolidate_duplicates(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_memory'
AS $function$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select a.memory_id, b.memory_id as keep_id
    from aria_memory.memory_items a
    join aria_memory.memory_items b
      on a.content_hash = b.content_hash
     and a.memory_id <> b.memory_id
     and a.created_at > b.created_at
    where a.status = 'active'
      and b.status = 'active'
      and a.metadata->>'privacy_class' = 'general'
      and b.metadata->>'privacy_class' = 'general'
    order by a.created_at
    limit greatest(1, least(p_limit, 1000))
  loop
    update aria_memory.memory_items
      set status = 'superseded', supersedes_memory_id = r.keep_id, updated_at = now()
    where memory_id = r.memory_id and status = 'active';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$


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
