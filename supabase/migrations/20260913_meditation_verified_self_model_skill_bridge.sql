create or replace function aria_internal.meditation_verified_self_model_skill_bridge()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_self_id uuid;
  v_skill_id uuid;
  v_goal_source text;
  v_goal_metadata jsonb := '{}'::jsonb;
  v_plan jsonb := coalesce(new.checkpoint->'plan','[]'::jsonb);
  v_results jsonb := coalesce(new.checkpoint->'results','{}'::jsonb);
  v_executor_types jsonb := coalesce(new.checkpoint->'executor_types','[]'::jsonb);
  v_verified_evidence jsonb;
begin
  if new.status <> 'succeeded' or old.status = 'succeeded' then
    return new;
  end if;

  select coalesce(metadata,'{}'::jsonb), metadata->>'source'
    into v_goal_metadata, v_goal_source
  from aria_internal.autonomy_goals
  where goal_id = new.metadata->>'goal_id'
  limit 1;

  if coalesce(new.metadata->>'source','') <> 'meditation-ia-v1'
     and coalesce(v_goal_source,'') <> 'meditation-ia-v1'
     and coalesce(v_goal_metadata->>'meditation_origin','false') <> 'true' then
    return new;
  end if;

  v_verified_evidence := jsonb_build_object(
    'mission_id', new.mission_id,
    'goal', new.goal,
    'goal_id', new.metadata->>'goal_id',
    'mission_source', new.metadata->>'source',
    'goal_source', v_goal_source,
    'status', new.status,
    'completed_steps', coalesce(new.completed_steps,0),
    'total_steps', coalesce(new.total_steps,0),
    'executor_types', v_executor_types,
    'plan', v_plan,
    'results', v_results,
    'verified_at', clock_timestamp()
  );

  v_self_id := aria_memory.upsert_world_entity(
    'system','ARIA','active',
    jsonb_build_object(
      'last_verified_mission_id', new.mission_id,
      'last_verified_goal', new.goal,
      'last_verified_executor_types', v_executor_types,
      'last_verified_goal_source', v_goal_source,
      'last_verified_at', clock_timestamp()
    ),
    0.95,
    'mission://' || new.mission_id,
    jsonb_build_object('source','meditation-ia-v1','kind','verified_mission_outcome')
  );

  insert into aria_memory.world_events(entity_id,event_type,payload)
  values (v_self_id,'meditation_verified_mission',v_verified_evidence);

  begin
    v_skill_id := aria_memory.compile_skill_for_goal(new.goal);
  exception when others then
    v_skill_id := null;
    insert into aria_memory.world_events(entity_id,event_type,payload)
    values (v_self_id,'skill_promotion_blocked',jsonb_build_object('mission_id',new.mission_id,'goal',new.goal,'reason',sqlerrm));
  end;

  insert into aria_memory.world_events(entity_id,event_type,payload)
  values (
    v_self_id,
    case when v_skill_id is null then 'meditation_cycle_postprocessed' else 'skill_promoted' end,
    jsonb_build_object(
      'mission_id', new.mission_id,
      'goal', new.goal,
      'goal_source', v_goal_source,
      'skill_id', v_skill_id,
      'skill_factory', 'compile_skill_for_goal',
      'promotion_evidence_required', 3
    )
  );

  return new;
end;
$function$;

drop trigger if exists trg_meditation_verified_self_model_skill_bridge on aria_internal.mission_state;
create trigger trg_meditation_verified_self_model_skill_bridge
after update of status on aria_internal.mission_state
for each row execute function aria_internal.meditation_verified_self_model_skill_bridge();
