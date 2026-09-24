-- ARIA Mastery Learning Loop v1
-- Failure -> prevention candidate -> planner recall -> mandatory application gate
-- -> verified success -> promotion -> regression contract -> future behavior change.

create index if not exists memory_items_metadata_gin_idx
  on aria_memory.memory_items using gin(metadata);

create or replace function aria_memory.learning_context_for_goal(
  p_goal text,
  p_limit integer default 12
)
returns table(
  memory_id uuid,
  memory_type text,
  title text,
  content text,
  status text,
  confidence numeric,
  metadata jsonb,
  source_ref text,
  application_required boolean
)
language sql
stable
security definer
set search_path = pg_catalog, aria_memory
as $$
  with q as (
    select lower(trim(coalesce(p_goal,''))) as goal
  )
  select
    m.memory_id,
    m.memory_type,
    m.title,
    m.content,
    m.status,
    m.confidence,
    m.metadata,
    m.source_ref,
    (
      m.status='active'
      and (
        coalesce(m.metadata->>'preflight_required','false')='true'
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
    ) as application_required
  from aria_memory.memory_items m, q
  where m.status in ('active','candidate')
    and m.memory_type in ('skill','lesson','procedural','semantic')
    and (
      m.search_tsv @@ websearch_to_tsquery('simple', regexp_replace(q.goal,'[^[:alnum:]_ -]',' ','g'))
      or position(q.goal in lower(coalesce(m.content,''))) > 0
      or position(q.goal in lower(coalesce(m.title,''))) > 0
      or lower(coalesce(m.metadata->>'scope','')) like '%supabase_edge_functions%'
      or (
        lower(coalesce(m.metadata->>'learning_kind',''))='failure_prevention'
        and (
          lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
          or lower(coalesce(m.metadata->>'scope','')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
          or exists (
            select 1 from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\\s+') token
            where length(token) >= 5 and position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
          )
        )
      )
    )
  order by
    case when m.status='active' then 0 else 1 end,
    case when (
      coalesce(m.metadata->>'preflight_required','false')='true'
      or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
    ) then 0 else 1 end,
    m.confidence desc,
    m.importance desc,
    m.updated_at desc
  limit greatest(1, least(coalesce(p_limit,12),50));
$$;

create or replace function aria_memory.promote_failure_learning(
  p_memory_id uuid,
  p_mission_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_memory, extensions
as $$
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
    and coalesce(metadata->>'learning_kind','')='failure_prevention';

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
    jsonb_build_object('regression',v_regression,'learning_kind','regression_contract'),
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
$$;

create or replace function public.aria_memory_learning_context_for_goal(
  p_goal text,
  p_limit integer default 12
)
returns table(
  memory_id uuid,
  memory_type text,
  title text,
  content text,
  status text,
  confidence numeric,
  metadata jsonb,
  source_ref text,
  application_required boolean
)
language sql
security definer
set search_path=''
as $$
  select * from aria_memory.learning_context_for_goal(p_goal,p_limit);
$$;

revoke all on function public.aria_memory_learning_context_for_goal(text,integer) from public,anon,authenticated;
grant execute on function public.aria_memory_learning_context_for_goal(text,integer) to service_role;
revoke all on function aria_memory.promote_failure_learning(uuid,text) from public,anon,authenticated;
grant execute on function aria_memory.promote_failure_learning(uuid,text) to service_role;

create or replace function aria_internal.validate_learning_preflight(
  p_goal text,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal, aria_memory
as $$
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
begin
  for v_skill in
    select m.memory_id,m.title,m.metadata,m.confidence
    from aria_memory.memory_items m
    where m.status='active'
      and m.memory_type in ('skill','procedural')
      and m.confidence >= .90
      and (
        coalesce(m.metadata->>'preflight_required','false')='true'
        or (
          coalesce(m.metadata->>'learning_kind','')='failure_prevention'
          and (
            lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
            or lower(coalesce(m.metadata->>'scope','')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
            or exists (
              select 1 from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\\s+') token
              where length(token) >= 5 and position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
            )
          )
        )
      )
      and (
        lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.content,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.metadata->>'scope','')) like '%supabase_edge_functions%'
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
  loop
    v_req := coalesce(v_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_mode := coalesce(v_req->>'mode','contains_all');
    v_terms := coalesce(v_req->'terms','[]'::jsonb);

    if jsonb_array_length(v_terms)=0 then
      continue;
    end if;

    if v_mode='contains_any' then
      select exists(
        select 1
        from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)>0
      ) into v_ok;
    else
      select not exists(
        select 1
        from jsonb_array_elements_text(v_terms) t
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
    select m.memory_id,m.title,m.metadata,m.confidence
    from aria_memory.memory_items m
    where m.status='candidate'
      and m.memory_type='skill'
      and coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      and (
        lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.metadata->>'scope','')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or exists (
          select 1 from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\\s+') token
          where length(token) >= 5 and position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
        )
      )
  loop
    v_req := coalesce(v_candidate.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);
    if jsonb_array_length(v_terms)=0 then
      continue;
    end if;
    select not exists(
      select 1 from jsonb_array_elements_text(v_terms) t
      where position(lower(t) in v_plan_text)=0
    ) and position('verify' in v_plan_text)>0 into v_ok;
    if v_ok then
      v_candidate_applied := v_candidate_applied || jsonb_build_array(v_candidate.memory_id::text);
    end if;
  end loop;

  return jsonb_build_object(
    'version','mastery-learning-loop-v1',
    'passed',jsonb_array_length(v_missing)=0,
    'required',v_required,
    'applied_memory_ids',v_applied || v_candidate_applied,
    'applied_active_memory_ids',v_applied,
    'applied_candidate_memory_ids',v_candidate_applied,
    'missing',v_missing
  );
end;
$$;

revoke all on function aria_internal.validate_learning_preflight(text,jsonb) from public,anon,authenticated;
grant execute on function aria_internal.validate_learning_preflight(text,jsonb) to service_role;

create or replace function aria_internal.verify_learning_application(
  p_goal text,
  p_steps jsonb,
  p_results jsonb,
  p_applied_memory_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal, aria_memory
as $$
declare
  v_required jsonb := '[]'::jsonb;
  v_verified jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_applied jsonb := coalesce(p_applied_memory_ids,'[]'::jsonb);
  v_execution_text text := lower(coalesce(p_steps,'[]'::jsonb)::text || ' ' || coalesce(p_results,'{}'::jsonb)::text);
  v_has_success boolean := v_execution_text ~ '"status"\s*:\s*"succeeded"';
  v_skill record;
  v_req jsonb;
  v_terms jsonb;
  v_ok boolean;
begin
  for v_skill in
    select m.memory_id,m.title,m.metadata,m.confidence
    from aria_memory.memory_items m
    where m.status='active'
      and m.memory_type in ('skill','procedural')
      and m.confidence >= .90
      and (
        coalesce(m.metadata->>'preflight_required','false')='true'
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
      and (
        lower(coalesce(m.title,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.content,'')) like '%'||lower(trim(coalesce(p_goal,'')))||'%'
        or lower(coalesce(m.metadata->>'scope','')) like '%supabase_edge_functions%'
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
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
      v_verified := v_verified || jsonb_build_array(v_skill.memory_id::text);
      continue;
    end if;

    select v_has_success
      and not exists(
        select 1
        from jsonb_array_elements_text(v_terms) t
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

  return jsonb_build_object(
    'version','mastery-learning-loop-v1',
    'passed',jsonb_array_length(v_missing)=0,
    'required_memory_ids',v_required,
    'verified_memory_ids',v_verified,
    'missing_memory_ids',v_missing,
    'has_successful_execution_evidence',v_has_success
  );
end;
$$;

revoke all on function aria_internal.verify_learning_application(text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function aria_internal.verify_learning_application(text,jsonb,jsonb,jsonb) to service_role;

create or replace function aria_internal.capture_failure_mastery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, aria_internal, aria_memory, extensions
as $$
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
    where memory_id=v_previous_id;

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
$$;

revoke all on function aria_internal.capture_failure_mastery() from public,anon,authenticated;
grant execute on function aria_internal.capture_failure_mastery() to service_role;

create or replace function aria_internal.promote_applied_failure_learning()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, aria_internal, aria_memory
as $$
declare
  v_id_text text;
  v_id uuid;
  v_promoted integer := 0;
  v_gate jsonb := coalesce(new.checkpoint->'learning_gate','{}'::jsonb);
begin
  if new.status <> 'succeeded' or (tg_op='UPDATE' and old.status='succeeded') then
    return new;
  end if;

  if coalesce(v_gate->>'application_verified','false') <> 'true' then
    return new;
  end if;

  for v_id_text in
    select jsonb_array_elements_text(coalesce(v_gate->'applied_memory_ids','[]'::jsonb))
  loop
    begin
      v_id := v_id_text::uuid;
    exception when others then
      continue;
    end;

    if (aria_memory.promote_failure_learning(v_id,new.mission_id))->>'promoted'='true' then
      v_promoted := v_promoted + 1;
    end if;
  end loop;

  if v_promoted>0 then
    update aria_internal.mission_state
    set checkpoint = jsonb_set(
      coalesce(checkpoint,'{}'::jsonb),
      '{learning_gate,promoted_failure_skills}',
      to_jsonb(v_promoted),
      true
    )
    where mission_id=new.mission_id;
  end if;

  return new;
end;
$$;

revoke all on function aria_internal.promote_applied_failure_learning() from public,anon,authenticated;
grant execute on function aria_internal.promote_applied_failure_learning() to service_role;

drop trigger if exists zzz_learning_mastery_failure_capture on aria_internal.mission_state;
create trigger zzz_learning_mastery_failure_capture
after insert or update of status on aria_internal.mission_state
for each row execute function aria_internal.capture_failure_mastery();

drop trigger if exists zzza_learning_mastery_success_promotion on aria_internal.mission_state;
create trigger zzza_learning_mastery_success_promotion
after update of status,checkpoint on aria_internal.mission_state
for each row execute function aria_internal.promote_applied_failure_learning();

-- Strengthen the existing deployment preflight learned skill:
update aria_memory.memory_items
set metadata = metadata
  || jsonb_build_object(
    'preflight_required',true,
    'preflight_requirements',jsonb_build_object('mode','contains_all','terms',jsonb_build_array('deno.json','import_map'))
  ),
  status='active',
  confidence=greatest(confidence,.98),
  updated_at=now()
where memory_id='a1f3c845-ad94-4c36-aa9f-5822e7f085a2'
  and memory_type='skill';

-- Existing generic failure reflections remain historical evidence; the new candidate/activation
-- path is the governed learning authority for future behavior.
