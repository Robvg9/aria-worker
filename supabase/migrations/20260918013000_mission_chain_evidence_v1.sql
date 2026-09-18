-- Persist trustworthy evidence that immediate mission chaining completed successfully.
create or replace function aria_internal.record_mission_chain_evidence(
  p_parent_mission_id text,
  p_child_mission_id text,
  p_worker_id text,
  p_depth integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  parent_state aria_internal.mission_state;
  child_state aria_internal.mission_state;
  ev jsonb;
begin
  select * into parent_state from aria_internal.mission_state where mission_id=p_parent_mission_id;
  if not found or parent_state.status<>'succeeded' then
    raise exception 'parent_mission_not_terminal_succeeded';
  end if;

  select * into child_state from aria_internal.mission_state where mission_id=p_child_mission_id;
  if not found or child_state.status<>'succeeded' then
    raise exception 'child_mission_not_terminal_succeeded';
  end if;

  if not exists(
    select 1 from aria_internal.mission_events e
    where e.mission_id=p_child_mission_id
      and e.event_type='mission_verified'
      and coalesce((e.payload->>'verified')::boolean,false)=true
  ) then
    raise exception 'child_mission_not_verified';
  end if;

  if not exists(
    select 1 from aria_internal.mission_events e
    where e.mission_id=p_parent_mission_id
      and e.event_type='mission_verified'
      and coalesce((e.payload->>'verified')::boolean,false)=true
  ) then
    raise exception 'parent_mission_not_verified';
  end if;

  ev:=jsonb_build_object(
    'parent_mission_id',p_parent_mission_id,
    'child_mission_id',p_child_mission_id,
    'worker_id',p_worker_id,
    'depth',p_depth,
    'immediate',true,
    'parent_status','succeeded',
    'child_status','succeeded',
    'parent_verified',true,
    'child_verified',true,
    'recorded_at',clock_timestamp(),
    'proof','successfully_verified_parent_then_successfully_verified_child_without_scheduler_tick'
  );

  update aria_internal.mission_state
     set checkpoint=coalesce(checkpoint,'{}'::jsonb)||jsonb_build_object('continuity_proof',ev),
         updated_at=clock_timestamp()
   where mission_id=p_parent_mission_id;

  insert into aria_internal.mission_events(mission_id,step_index,event_type,payload)
  values(p_parent_mission_id,null,'mission_chain_completed',ev);

  return ev;
end;
$function$;

revoke all on function aria_internal.record_mission_chain_evidence(text,text,text,integer) from public,anon,authenticated;
grant execute on function aria_internal.record_mission_chain_evidence(text,text,text,integer) to service_role;

comment on function aria_internal.record_mission_chain_evidence(text,text,text,integer)
is 'Continuity proof event: records verified parent->verified child immediate chaining after both missions are terminal succeeded.';
