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

-- Keep the existing mastery/preflight behavior but require explicit general classification at every read/write boundary.

CREATE OR REPLACE FUNCTION aria_internal.capture_failure_mastery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_internal', 'aria_memory', 'extensions'
AS $function$
declare
  v_detail text;
  v_goal text;
  v_signature text;
  v_terms jsonb := '[]'::jsonb;
  v_content text;
  v_hash text;
  v_id uuid;
  v_procedure jsonb;
  v_previous_id uuid;
  v_previous_status text;
  v_occurrence integer := 0;
  v_state text := 'incident';
  v_recurred_after_promotion boolean := false;
begin
  if new.status <> 'failed' or (tg_op='UPDATE' and old.status='failed') then
    return new;
  end if;
  -- Do not derive memory from an unclassified mission or its logs.
  if coalesce(new.metadata->>'privacy_class','') IS DISTINCT FROM 'general' then
    return new;
  end if;

  v_goal := trim(coalesce(new.goal,''));
  v_detail := lower(left(coalesce(new.last_stderr,'') || ' ' || coalesce(new.next_action,'') || ' ' || coalesce(new.checkpoint->'recovery'->>'failure_reason',''),3000));
  v_signature := encode(extensions.digest(
    lower(v_goal) || '|' ||
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(v_detail,'mission[_-][0-9a-f-]+','<mission>','gi'),
          '[0-9a-f]{8}-[0-9a-f-]{20,}','<uuid>','gi'
        ),
        '[0-9]+','<n>','g'
      ),
      '\\s+',' ','g'
    ) || '|' ||
    regexp_replace(coalesce(new.checkpoint->'recovery'->>'failure_reason',''), '[0-9]+','<n>','g'),
    'sha256'
  ),'hex');

  if position('deno.json' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('deno.json'); end if;
  if position('import_map' in v_detail)>0 or position('import-map' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('import_map'); end if;
  if position('wrangler.toml' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('wrangler.toml'); end if;
  if position('migration' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('migration'); end if;
  if position('rls' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('rls'); end if;
  if position('branch' in v_detail) > 0 or position('pull request' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('branch'); end if;
  if jsonb_array_length(v_terms)=0 then v_terms := jsonb_build_array('verify'); end if;

  v_procedure := jsonb_build_array(
    'Recuperar el fallo previo y su evidencia antes de elegir una estrategia.',
    'No repetir la estrategia fallida salvo que exista evidencia nueva y explícita que la justifique.',
    'Verificar los prerrequisitos asociados al fallo antes de ejecutar la acción.',
    'Ejecutar una verificación real del resultado y persistir la evidencia.'
  );

  select m.memory_id,m.status,
         greatest(1,coalesce((m.metadata->>'occurrence_count')::integer,1))
    into v_previous_id,v_previous_status,v_occurrence
  from aria_memory.memory_items m
  where coalesce(m.metadata->>'learning_kind','')='failure_prevention'
    and m.metadata->>'privacy_class'='general'
    and m.metadata->>'failure_signature'=v_signature
    and m.memory_type='skill'
  order by case when m.status='active' then 0 else 1 end, m.updated_at desc
  limit 1;

  if v_previous_id is null then
    v_occurrence := 1;
  else
    v_occurrence := v_occurrence + 1;
    v_recurred_after_promotion := v_previous_status='active';
  end if;

  v_state := case
    when v_recurred_after_promotion then 'root_cause_required'
    when v_occurrence >= 5 then 'root_cause_required'
    when v_occurrence >= 4 then 'pattern_confirmed'
    when v_occurrence >= 3 then 'pattern_candidate'
    when v_occurrence >= 2 then 'recurrent'
    else 'incident'
  end;

  if v_state='root_cause_required' then
    v_terms := v_terms || jsonb_build_array('root_cause','verify');
  end if;

  if v_previous_id is not null then
    update aria_memory.memory_items
    set
      updated_at=now(),
      metadata = metadata
        || jsonb_build_object(
          'occurrence_count',v_occurrence,
          'pattern_state',v_state,
          'recurrence_after_promotion',v_recurred_after_promotion,
          'last_seen_mission',new.mission_id,
          'last_seen_at',clock_timestamp()
        ),
      confidence = greatest(confidence,case when v_state='root_cause_required' then .94 else .88 end)
    where memory_id=v_previous_id and metadata->>'privacy_class'='general';

    insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
    values(
      v_previous_id,
      'updated',
      new.mission_id,
      jsonb_build_object(
        'occurrence_count',v_occurrence,
        'pattern_state',v_state,
        'recurrence_after_promotion',v_recurred_after_promotion
      )
    );
  end if;

  v_content := 'Failure-prevention candidate. Goal='||v_goal||
    '. Failure detail='||left(v_detail,1800)||
    '. Prevention procedure='||v_procedure::text;

  v_hash := encode(extensions.digest('failure-prevention|'||v_signature,'sha256'),'hex');

  insert into aria_memory.memory_items(
    memory_type,title,content,content_hash,status,confidence,importance,salience,
    source_type,source_ref,provenance,metadata
  )
  values(
    'skill',
    'Failure prevention candidate: '||left(v_goal,160),
    v_content,
    v_hash,
    'candidate',
    .88,.90,.95,
    'mission',
    new.mission_id,
    jsonb_build_object('engine','failure-mastery-v1','mission_id',new.mission_id,'failure_signature',v_signature),
    jsonb_build_object(
      'learning_kind','failure_prevention',
      'privacy_class','general',
      'activation_status',case when v_previous_id is null then 'candidate' else coalesce((select metadata->>'activation_status' from aria_memory.memory_items where memory_id=v_previous_id),'candidate') end,
      'source_mission_id',new.mission_id,
      'failure_signature',v_signature,
      'scope',v_goal,
      'procedure',v_procedure,
      'preflight_required',case when v_previous_status='active' then true else false end,
      'preflight_requirements',jsonb_build_object('mode','contains_all','terms',v_terms),
      'occurrence_count',v_occurrence,
      'pattern_state',v_state,
      'recurrence_after_promotion',v_recurred_after_promotion
    )
  )
  on conflict(content_hash) do update
    set content=excluded.content, updated_at=now(), metadata=excluded.metadata, confidence=greatest(aria_memory.memory_items.confidence,excluded.confidence)
  returning memory_id into v_id;

  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
  values(
    v_id,'created',new.mission_id,
    jsonb_build_object('failure_signature',v_signature,'terms',v_terms,'procedure',v_procedure,'occurrence_count',v_occurrence,'pattern_state',v_state,'recurrence_after_promotion',v_recurred_after_promotion)
  );

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION aria_internal.enforce_learning_preflight()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_matches jsonb:='[]'::jsonb;
  v_match jsonb;
  v_meta jsonb;
  v_req jsonb;
  v_mode text;
  v_terms jsonb;
  v_plan_text text;
  v_deployment boolean:=false;
  v_failed boolean:=false;
  v_learning_gate_mode text:=lower(coalesce(new.metadata->>'learning_gate_mode','advisory'));
begin
  if tg_op <> 'UPDATE' or new.status <> 'running' or old.status = 'running' then
    return new;
  end if;

  -- The runner owns the canonical learning policy. The DB trigger must never
  -- impose a hard gate on a mission that did not explicitly request one.
  if v_learning_gate_mode <> 'hard' then
    new.checkpoint:=jsonb_set(
      coalesce(new.checkpoint,'{}'::jsonb),
      '{cognitive_preflight}',
      jsonb_build_object(
        'status','passed',
        'matched_skills','[]'::jsonb,
        'deployment',false,
        'checked_at',now(),
        'advisory_only',true,
        'learning_gate_mode',v_learning_gate_mode
      ),
      true
    );
    return new;
  end if;

  v_plan_text:=lower(coalesce(new.checkpoint->'plan','{}'::jsonb)::text);
  v_deployment:=lower(coalesce(new.goal,'')) ~ '(^|[^a-z])(deploy|deployment|deploying|release|publish)([^a-z]|$)'
    and lower(coalesce(new.goal,'')) !~ '(^|[^a-z])(read[- ]only|audit|review|inspect|diagnostic|forensic)([^a-z]|$)';

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'memory_id',m.memory_id,
      'title',m.title,
      'scope',m.metadata->>'scope',
      'confidence',m.confidence,
      'preflight_requirements',m.metadata->'preflight_requirements'
    )),
    '[]'::jsonb
  )
    into v_matches
    from aria_memory.memory_items m
   where m.status='active'
     and m.memory_type='skill'
     and coalesce(m.metadata->>'preflight_required','false')='true'
     and m.confidence>=.9
     and m.metadata->>'privacy_class'='general'
     and (
       lower(coalesce(m.title,'')) like '%'||lower(trim(new.goal))||'%'
       or lower(coalesce(m.content,'')) like '%'||lower(trim(new.goal))||'%'
       or lower(coalesce(m.metadata->>'scope','')) like '%supabase_edge_functions%'
     );

  for v_match in select * from jsonb_array_elements(v_matches) loop
    v_meta:=v_match->'preflight_requirements';
    if v_meta is null or jsonb_typeof(v_meta)<>'object' then continue; end if;
    v_mode:=coalesce(v_meta->>'mode','contains_all');
    v_terms:=coalesce(v_meta->'terms','[]'::jsonb);

    if v_mode='contains_any' then
      if not exists (
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)>0
      ) then v_failed:=true; end if;
    elsif v_mode='contains_all' then
      if exists (
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)=0
      ) then v_failed:=true; end if;
    end if;
  end loop;

  if v_deployment and v_failed and jsonb_array_length(v_matches)>0 then
    new.checkpoint:=jsonb_set(
      coalesce(new.checkpoint,'{}'::jsonb),
      '{cognitive_preflight}',
      jsonb_build_object(
        'status','blocked',
        'reason','learned_preflight_missing',
        'matched_skills',v_matches,
        'deployment',true,
        'learning_gate_mode','hard'
      ),
      true
    );
    new.next_action:='replan: satisfy learned preflight contract before execution';
    raise exception 'learning_preflight_blocked:declared_requirements_not_satisfied';
  end if;

  new.checkpoint:=jsonb_set(
    coalesce(new.checkpoint,'{}'::jsonb),
    '{cognitive_preflight}',
    jsonb_build_object(
      'status','passed',
      'matched_skills',v_matches,
      'deployment',v_deployment,
      'checked_at',now(),
      'learning_gate_mode','hard'
    ),
    true
  );
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION aria_internal.validate_learning_preflight(p_goal text, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_internal', 'aria_memory'
AS $function$
declare
  v_plan_text text := lower(coalesce(p_plan,'[]'::jsonb)::text);
  v_required jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_candidate_applied jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_skill record;
  v_candidate record;
  v_req jsonb;
  v_terms jsonb;
  v_mode text;
  v_ok boolean;
  v_action boolean := jsonb_typeof(coalesce(p_plan->'steps','[]'::jsonb))='array'
    and jsonb_array_length(coalesce(p_plan->'steps','[]'::jsonb)) > 0;
begin
  if not v_action then
    return jsonb_build_object(
      'version','mastery-learning-loop-v1-generic-action',
      'passed',true,
      'required',v_required,
      'applied_memory_ids',v_applied,
      'applied_active_memory_ids',v_applied,
      'applied_candidate_memory_ids',v_candidate_applied,
      'missing',v_missing,
      'learning_application_required',false
    );
  end if;

  for v_skill in
    select m.memory_id,m.title,m.content,m.metadata,m.confidence
    from aria_memory.memory_items m
    where m.status='active'
      and m.memory_type in ('skill','procedural')
      and m.confidence >= .90
      and m.metadata->>'privacy_class'='general'
      and (
        coalesce(m.metadata->>'preflight_required','false')='true'
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
      and (
        lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.content,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.metadata->>'scope','')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or (
          coalesce(m.metadata->>'learning_kind','')='failure_prevention'
          and exists (
            select 1
            from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\s+') token
            where length(token) >= 5
              and position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
          )
        )
      )
  loop
    v_req := coalesce(v_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_mode := coalesce(v_req->>'mode','contains_all');
    v_terms := coalesce(v_req->'terms','[]'::jsonb);

    if jsonb_array_length(v_terms)=0 then
      -- A learned skill without explicit terms is still an applied context requirement;
      -- it is satisfied by explicit skill memory injection into the plan context.
      v_required := v_required || jsonb_build_array(
        jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'confidence',v_skill.confidence,'mode','context_only')
      );
      v_applied := v_applied || jsonb_build_array(v_skill.memory_id::text);
      continue;
    end if;

    if v_mode='contains_any' then
      select exists(
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)>0
      ) into v_ok;
    else
      select not exists(
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)=0
      ) into v_ok;
    end if;

    v_required := v_required || jsonb_build_array(
      jsonb_build_object(
        'memory_id',v_skill.memory_id,
        'title',v_skill.title,
        'confidence',v_skill.confidence,
        'mode',v_mode,
        'terms',v_terms
      )
    );

    if v_ok then
      v_applied := v_applied || jsonb_build_array(v_skill.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object(
          'memory_id',v_skill.memory_id,
          'title',v_skill.title,
          'mode',v_mode,
          'terms',v_terms
        )
      );
    end if;
  end loop;

  for v_candidate in
    select m.memory_id,m.title,m.content,m.metadata,m.confidence
    from aria_memory.memory_items m
    where m.status='candidate'
      and m.memory_type='skill'
      and coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      and m.metadata->>'privacy_class'='general'
      and (
        lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.metadata->>'scope','')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.content,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or exists (
          select 1 from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\s+') token
          where length(token) >= 5
            and (
              position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
              or position(token in lower(coalesce(m.title,''))) > 0
            )
        )
      )
  loop
    v_req := coalesce(v_candidate.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);

    if jsonb_array_length(v_terms)=0 then
      v_candidate_applied := v_candidate_applied || jsonb_build_array(v_candidate.memory_id::text);
      continue;
    end if;

    select not exists(
      select 1 from jsonb_array_elements_text(v_terms) t
      where position(lower(t) in v_plan_text)=0
    )
    and position('verify' in v_plan_text)>0
    into v_ok;

    if v_ok then
      v_candidate_applied := v_candidate_applied || jsonb_build_array(v_candidate.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object(
          'memory_id',v_candidate.memory_id,
          'title',v_candidate.title,
          'mode','candidate_prevention',
          'terms',v_terms
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'version','mastery-learning-loop-v1-generic-action',
    'passed',jsonb_array_length(v_missing)=0,
    'required',v_required,
    'applied_memory_ids',v_applied || v_candidate_applied,
    'applied_active_memory_ids',v_applied,
    'applied_candidate_memory_ids',v_candidate_applied,
    'missing',v_missing,
    'learning_application_required',true
  );
end;
$function$;
CREATE OR REPLACE FUNCTION aria_internal.verify_learning_application(p_goal text, p_steps jsonb, p_results jsonb, p_applied_memory_ids jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_internal', 'aria_memory'
AS $function$
declare
  v_required jsonb := '[]'::jsonb;
  v_verified jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_applied jsonb := coalesce(p_applied_memory_ids,'[]'::jsonb);
  v_execution_text text := lower(coalesce(p_steps,'[]'::jsonb)::text || ' ' || coalesce(p_results,'{}'::jsonb)::text);
  v_has_success boolean := v_execution_text ~ '"status"\s*:\s*"succeeded"';
  v_skill record;
  v_applied_skill record;
  v_req jsonb;
  v_terms jsonb;
  v_ok boolean;
begin
  for v_skill in
    select m.memory_id,m.title,m.content,m.metadata,m.confidence
    from aria_memory.memory_items m
    where m.status='active'
      and m.memory_type in ('skill','procedural')
      and m.confidence >= .90
      and m.metadata->>'privacy_class'='general'
      and (
        coalesce(m.metadata->>'preflight_required','false')='true'
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
      and (
        lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.content,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.metadata->>'scope','')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or (
          coalesce(m.metadata->>'learning_kind','')='failure_prevention'
          and (
            (
              lower(trim(coalesce(m.metadata->>'scope',''))) = 'deploy supabase edge function'
              and lower(trim(coalesce(p_goal,''))) ~ '(deploy|deployment|deploying|desplegar|despliegue)'
              and lower(trim(coalesce(p_goal,''))) ~ '(edge function|edge functions|edge-function|función edge|funcion edge)'
            )
            or (
              lower(trim(coalesce(m.metadata->>'scope',''))) <> 'deploy supabase edge function'
              and exists (
                select 1
                from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\s+') token
                where length(token) >= 5
                  and token not in ('supabase','database','project','mission','function','functions','edge','api','sql','read','write','execute','tool','runtime','aria','step')
                  and position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
              )
            )
          )
        )
      )
  loop
    v_required := v_required || jsonb_build_array(v_skill.memory_id::text);

    if not (v_applied ? (v_skill.memory_id::text)) then
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'reason','not_marked_applied_before_execution')
      );
      continue;
    end if;

    v_req := coalesce(v_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);

    if jsonb_array_length(v_terms)=0 then
      if v_has_success then
        v_verified := v_verified || jsonb_build_array(v_skill.memory_id::text);
      else
        v_missing := v_missing || jsonb_build_array(
          jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'reason','no_successful_execution_evidence')
        );
      end if;
      continue;
    end if;

    select v_has_success
      and not exists(
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_execution_text)=0
      )
      into v_ok;

    if v_ok then
      v_verified := v_verified || jsonb_build_array(v_skill.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object(
          'memory_id',v_skill.memory_id,
          'title',v_skill.title,
          'terms',v_terms,
          'reason',case when not v_has_success then 'no_successful_execution_evidence' else 'required_terms_missing_from_execution_evidence' end
        )
      );
    end if;
  end loop;

  for v_applied_skill in
    select m.memory_id,m.title,m.content,m.metadata,m.status,m.confidence
    from aria_memory.memory_items m
    where m.memory_type='skill'
      and coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      and m.metadata->>'privacy_class'='general'
      and m.memory_id::text in (select jsonb_array_elements_text(v_applied))
  loop
    if v_applied_skill.status <> 'candidate' then continue; end if;

    v_req := coalesce(v_applied_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);

    if jsonb_array_length(v_terms)=0 then
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object('memory_id',v_applied_skill.memory_id,'title',v_applied_skill.title,'reason','candidate_has_no_preflight_terms')
      );
      continue;
    end if;

    select v_has_success
      and not exists(
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_execution_text)=0
      )
      into v_ok;

    if v_ok then
      v_verified := v_verified || jsonb_build_array(v_applied_skill.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(
        jsonb_build_object(
          'memory_id',v_applied_skill.memory_id,
          'title',v_applied_skill.title,
          'terms',v_terms,
          'reason',case when not v_has_success then 'candidate_no_successful_execution_evidence' else 'candidate_terms_missing_from_execution_evidence' end
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'version','mastery-learning-loop-v1-generic-action',
    'passed',jsonb_array_length(v_missing)=0,
    'required_memory_ids',v_required,
    'verified_memory_ids',v_verified,
    'missing_memory_ids',v_missing,
    'has_successful_execution_evidence',v_has_success,
    'learning_application_required',true
  );
end;
$function$;
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
$function$;
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
$function$;
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
$function$;
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
$function$;
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


-- Scoped text-wrapper delegates to the class-filtered user-scoped hybrid search.
CREATE OR REPLACE FUNCTION public.aria_memory_search_hybrid_text_scoped(
  p_owner_user_id uuid,
  p_query text,
  p_query_embedding_text text DEFAULT NULL::text,
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
  SELECT *
  FROM aria_memory.search_hybrid_user_scoped(
    p_owner_user_id,
    p_query,
    CASE WHEN p_query_embedding_text IS NULL THEN NULL ELSE p_query_embedding_text::extensions.vector END,
    p_limit,
    p_lexical_weight,
    p_semantic_weight,
    p_rrf_k
  );
$function$;
COMMIT;
