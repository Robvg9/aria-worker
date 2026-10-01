
create or replace function aria_internal.enforce_learning_preflight()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_matches jsonb:='[]'::jsonb;
  v_match jsonb;
  v_meta jsonb;
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
