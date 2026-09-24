-- ARIA Mastery Learning Loop v1 — candidate application verification hardening
-- A candidate failure-prevention skill must itself have execution evidence before promotion.

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
  v_applied_skill record;
  v_req jsonb;
  v_terms jsonb;
  v_ok boolean;
begin
  -- Active preflight skills are mandatory.
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

  -- Any failure-prevention candidate explicitly marked as applied must also be evidenced.
  for v_applied_skill in
    select m.memory_id,m.title,m.metadata,m.status,m.confidence
    from aria_memory.memory_items m
    where m.memory_type='skill'
      and coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      and m.memory_id::text in (
        select jsonb_array_elements_text(v_applied)
      )
  loop
    if v_applied_skill.status <> 'candidate' then
      continue;
    end if;

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
        select 1
        from jsonb_array_elements_text(v_terms) t
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
    'version','mastery-learning-loop-v1-candidate-verification',
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


create or replace function aria_internal.goal_requires_deployment_preflight(p_goal text)
returns boolean
language sql
immutable
as $$
  select
    lower(coalesce(p_goal,'')) ~ '(deploy|deployment|release|publish|apply migration|edge function|supabase function|function deploy)'
    and lower(coalesce(p_goal,'')) !~ '(read[- ]only|audit|review|inspect|diagnostic|forensic)'
$$;

-- Restrict learned preflight enforcement to actions whose goal is actually a deployment/change.
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
  v_requires boolean := aria_internal.goal_requires_deployment_preflight(p_goal);
begin
  if not v_requires then
    return jsonb_build_object(
      'version','mastery-learning-loop-v1',
      'passed',true,
      'required',v_required,
      'applied_memory_ids',v_applied,
      'applied_active_memory_ids',v_applied,
      'applied_candidate_memory_ids',v_candidate_applied,
      'missing',v_missing,
      'deployment_preflight_required',false
    );
  end if;

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
        or (
          lower(coalesce(m.metadata->>'scope','')) like '%supabase_edge_functions%'
          and lower(coalesce(p_goal,'')) ~ '(deploy|deployment|edge function|supabase function|function deploy)'
        )
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
  loop
    v_req := coalesce(v_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_mode := coalesce(v_req->>'mode','contains_all');
    v_terms := coalesce(v_req->'terms','[]'::jsonb);
    if jsonb_array_length(v_terms)=0 then continue; end if;

    if v_mode='contains_any' then
      select exists(select 1 from jsonb_array_elements_text(v_terms) t where position(lower(t) in v_plan_text)>0) into v_ok;
    else
      select not exists(select 1 from jsonb_array_elements_text(v_terms) t where position(lower(t) in v_plan_text)=0) into v_ok;
    end if;

    v_required := v_required || jsonb_build_array(jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'confidence',v_skill.confidence,'mode',v_mode,'terms',v_terms));
    if v_ok then
      v_applied := v_applied || jsonb_build_array(v_skill.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'mode',v_mode,'terms',v_terms));
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
          select 1 from regexp_split_to_table(lower(trim(coalesce(p_goal,''))),'\s+') token
          where length(token) >= 5 and position(token in lower(coalesce(m.metadata->>'scope',''))) > 0
        )
      )
  loop
    v_req := coalesce(v_candidate.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);
    if jsonb_array_length(v_terms)=0 then continue; end if;
    select not exists(select 1 from jsonb_array_elements_text(v_terms) t where position(lower(t) in v_plan_text)=0)
      and position('verify' in v_plan_text)>0 into v_ok;
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
    'missing',v_missing,
    'deployment_preflight_required',true
  );
end;
$$;

-- Post-action verification uses the same relevance boundary.
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
  v_applied_skill record;
  v_req jsonb;
  v_terms jsonb;
  v_ok boolean;
  v_requires boolean := aria_internal.goal_requires_deployment_preflight(p_goal);
begin
  if not v_requires then
    return jsonb_build_object(
      'version','mastery-learning-loop-v1-candidate-verification',
      'passed',true,
      'required_memory_ids',v_required,
      'verified_memory_ids',v_verified,
      'missing_memory_ids',v_missing,
      'has_successful_execution_evidence',v_has_success,
      'deployment_preflight_required',false
    );
  end if;

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
        or (
          lower(coalesce(m.metadata->>'scope','')) like '%supabase_edge_functions%'
          and lower(coalesce(p_goal,'')) ~ '(deploy|deployment|edge function|supabase function|function deploy)'
        )
        or coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      )
  loop
    v_required := v_required || jsonb_build_array(v_skill.memory_id::text);
    if not (v_applied ? (v_skill.memory_id::text)) then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'reason','not_marked_applied_before_execution'));
      continue;
    end if;
    v_req := coalesce(v_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);
    if jsonb_array_length(v_terms)=0 then
      v_verified := v_verified || jsonb_build_array(v_skill.memory_id::text);
      continue;
    end if;
    select v_has_success and not exists(select 1 from jsonb_array_elements_text(v_terms) t where position(lower(t) in v_execution_text)=0) into v_ok;
    if v_ok then
      v_verified := v_verified || jsonb_build_array(v_skill.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('memory_id',v_skill.memory_id,'title',v_skill.title,'terms',v_terms,'reason',case when not v_has_success then 'no_successful_execution_evidence' else 'required_terms_missing_from_execution_evidence' end));
    end if;
  end loop;

  for v_applied_skill in
    select m.memory_id,m.title,m.metadata,m.status,m.confidence
    from aria_memory.memory_items m
    where m.memory_type='skill'
      and coalesce(m.metadata->>'learning_kind','')='failure_prevention'
      and m.memory_id::text in (select jsonb_array_elements_text(v_applied))
  loop
    if v_applied_skill.status <> 'candidate' then continue; end if;
    v_req := coalesce(v_applied_skill.metadata->'preflight_requirements','{}'::jsonb);
    v_terms := coalesce(v_req->'terms','[]'::jsonb);
    if jsonb_array_length(v_terms)=0 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('memory_id',v_applied_skill.memory_id,'title',v_applied_skill.title,'reason','candidate_has_no_preflight_terms'));
      continue;
    end if;
    select v_has_success and not exists(select 1 from jsonb_array_elements_text(v_terms) t where position(lower(t) in v_execution_text)=0) into v_ok;
    if v_ok then
      v_verified := v_verified || jsonb_build_array(v_applied_skill.memory_id::text);
    else
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('memory_id',v_applied_skill.memory_id,'title',v_applied_skill.title,'terms',v_terms,'reason',case when not v_has_success then 'candidate_no_successful_execution_evidence' else 'candidate_terms_missing_from_execution_evidence' end));
    end if;
  end loop;

  return jsonb_build_object(
    'version','mastery-learning-loop-v1-candidate-verification',
    'passed',jsonb_array_length(v_missing)=0,
    'required_memory_ids',v_required,
    'verified_memory_ids',v_verified,
    'missing_memory_ids',v_missing,
    'has_successful_execution_evidence',v_has_success,
    'deployment_preflight_required',true
  );
end;
$$;

revoke all on function aria_internal.goal_requires_deployment_preflight(text) from public,anon,authenticated;
grant execute on function aria_internal.goal_requires_deployment_preflight(text) to service_role;
revoke all on function aria_internal.validate_learning_preflight(text,jsonb) from public,anon,authenticated;
grant execute on function aria_internal.validate_learning_preflight(text,jsonb) to service_role;
revoke all on function aria_internal.verify_learning_application(text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function aria_internal.verify_learning_application(text,jsonb,jsonb,jsonb) to service_role;
