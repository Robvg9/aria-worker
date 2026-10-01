-- Fix false-positive learning preflight on general missions.
-- The deployment skill may gate only an actual Edge Function deployment step,
-- never a broad mission merely mentioning deployment in its acceptance scope.

create or replace function aria_internal.enforce_learning_preflight()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_matches jsonb := '[]'::jsonb;
  v_match jsonb;
  v_meta jsonb;
  v_req jsonb;
  v_mode text;
  v_terms jsonb;
  v_plan_text text;
  v_deployment boolean := false;
  v_failed boolean := false;
begin
  if tg_op <> 'UPDATE' or new.status <> 'running' or old.status = 'running' then
    return new;
  end if;

  v_plan_text := lower(coalesce(new.checkpoint->'plan','{}'::jsonb)::text);

  -- Deployment intent is determined from the executable plan, not merely the
  -- mission's broad goal text. A PWA mission may contain deployment as one
  -- acceptance area without being an Edge Function deployment mission.
  v_deployment :=
    v_plan_text ~ '"operation"\s*:\s*"(deploy|deploy_edge_function|function_deploy|edge_function_deploy)'
    or (
      v_plan_text ~ '"connector_id"\s*:\s*"supabase"'
      and v_plan_text ~ '(edge function|supabase function|deploy)'
    )
    or (
      v_plan_text ~ '"operation"\s*:\s*"(delegate|tool_use|connector_execute|file_write)'
      and v_plan_text ~ '(edge function|supabase function)'
      and v_plan_text ~ '(deploy|deployment)'
    );

  if not v_deployment then
    new.checkpoint := jsonb_set(
      coalesce(new.checkpoint,'{}'::jsonb),
      '{cognitive_preflight}',
      jsonb_build_object(
        'status','passed',
        'matched_skills','[]'::jsonb,
        'deployment',false,
        'policy','deployment_skill_applies_to_actual_edge_function_deployments_only',
        'checked_at',now()
      ),
      true
    );
    return new;
  end if;

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
    and (
      lower(coalesce(m.title,'')) like '%supabase edge function%'
      or lower(coalesce(m.title,'')) like '%edge function%'
      or lower(coalesce(m.metadata->>'scope','')) = 'supabase_edge_functions'
    );

  for v_match in select * from jsonb_array_elements(v_matches) loop
    v_meta := v_match->'preflight_requirements';
    if v_meta is null or jsonb_typeof(v_meta)<>'object' then
      continue;
    end if;
    v_mode := coalesce(v_meta->>'mode','contains_all');
    v_terms := coalesce(v_meta->'terms','[]'::jsonb);

    if v_mode='contains_any' then
      if not exists (
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)>0
      ) then
        v_failed := true;
      end if;
    elsif v_mode='contains_all' then
      if exists (
        select 1 from jsonb_array_elements_text(v_terms) t
        where position(lower(t) in v_plan_text)=0
      ) then
        v_failed := true;
      end if;
    end if;
  end loop;

  if v_failed and jsonb_array_length(v_matches)>0 then
    new.checkpoint := jsonb_set(
      coalesce(new.checkpoint,'{}'::jsonb),
      '{cognitive_preflight}',
      jsonb_build_object(
        'status','blocked',
        'reason','learned_preflight_missing',
        'matched_skills',v_matches,
        'deployment',true
      ),
      true
    );
    new.next_action := 'replan: satisfy learned preflight contract before execution';
    raise exception 'learning_preflight_blocked:declared_requirements_not_satisfied';
  end if;

  new.checkpoint := jsonb_set(
    coalesce(new.checkpoint,'{}'::jsonb),
    '{cognitive_preflight}',
    jsonb_build_object(
      'status','passed',
      'matched_skills',v_matches,
      'deployment',true,
      'policy','deployment_skill_applies_to_actual_edge_function_deployments_only',
      'checked_at',now()
    ),
    true
  );
  return new;
end;
$$;

revoke all on function aria_internal.enforce_learning_preflight() from public,anon,authenticated;
