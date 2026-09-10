-- Learning -> execution prevention gate.
-- A verified skill may declare its own preflight contract in metadata.preflight_requirements:
-- {"mode":"contains_any"|"contains_all","terms":[...]}
-- The gate runs before mission_state enters running and fails closed when a declared
-- deployment preflight requirement is not represented in the normalized plan.

update aria_memory.memory_items
set metadata = metadata || jsonb_build_object(
  'preflight_requirements',
  jsonb_build_object('mode','contains_any','terms',jsonb_build_array('deno.json','import_map'))
)
where memory_id = 'a1f3c845-ad94-4c36-aa9f-5822e7f085a2'
  and memory_type = 'skill';

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
  v_deployment := lower(coalesce(new.goal,'')) ~ '(deploy|deployment|edge function|supabase function|function deploy)';

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

  if v_deployment and v_failed and jsonb_array_length(v_matches)>0 then
    new.checkpoint := jsonb_set(
      coalesce(new.checkpoint,'{}'::jsonb),
      '{cognitive_preflight}',
      jsonb_build_object(
        'status','blocked',
        'reason','learned_preflight_missing',
        'matched_skills',v_matches
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
      'deployment',v_deployment,
      'checked_at',now()
    ),
    true
  );
  return new;
end;
$$;

revoke all on function aria_internal.enforce_learning_preflight() from public,anon,authenticated;

drop trigger if exists trg_learning_preflight_gate on aria_internal.mission_state;
create trigger trg_learning_preflight_gate
before update of status,checkpoint,goal on aria_internal.mission_state
for each row execute function aria_internal.enforce_learning_preflight();
