-- Mission 2/7: governed execution verification and real Human Gate completion.
create or replace function aria_internal.meditation_human_gate_complete(
  p_mission_id text,
  p_device_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, aria_internal
as $$
declare
  r aria_internal.mission_state;
  gate jsonb;
begin
  if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_device_id),'')='' then raise exception 'device_id_required'; end if;

  select * into r
    from aria_internal.mission_state
   where mission_id=p_mission_id
     and metadata->>'source' like 'meditation-%'
   for update;

  if not found then raise exception 'mission_not_found'; end if;

  gate := coalesce(r.metadata->'human_gate','{}'::jsonb);
  if jsonb_typeof(gate)<>'object'
     or coalesce((gate->>'enabled')::boolean,false) is not true
     or coalesce(btrim(gate->>'method'),'')='' then
    raise exception 'no_real_human_gate';
  end if;

  if coalesce(r.metadata->>'device_id','')<>p_device_id then
    raise exception 'human_gate_device_mismatch';
  end if;

  if r.status not in ('paused','blocked','queued') then
    raise exception 'human_gate_wrong_state:%',r.status;
  end if;

  update aria_internal.mission_state
     set status='queued',
         next_action='resume:human_gate_verified',
         checkpoint=jsonb_set(
           jsonb_set(
             coalesce(checkpoint,'{}'::jsonb),
             '{human_gate,status}',
             '"completed"'::jsonb,
             true
           ),
           '{human_gate,verified}',
           'true'::jsonb,
           true
         ) || jsonb_build_object('human_gate', coalesce(checkpoint->'human_gate','{}'::jsonb) || jsonb_build_object(
           'required',true,
           'status','completed',
           'verified',true,
           'method',gate->>'method',
           'note',nullif(p_note,''),
           'verified_at',clock_timestamp()::text,
           'verified_by_device',p_device_id
         )),
         updated_at=clock_timestamp()
   where mission_id=p_mission_id
   returning * into r;

  insert into aria_internal.mission_events(mission_id,event_type,payload)
  values (
    p_mission_id,
    'human_gate_completed',
    jsonb_build_object(
      'verified',true,
      'method',gate->>'method',
      'note',nullif(p_note,''),
      'device_id',p_device_id
    )
  );

  return to_jsonb(r);
end;
$$;

revoke all on function aria_internal.meditation_human_gate_complete(text,text,text) from public, anon, authenticated;
grant execute on function aria_internal.meditation_human_gate_complete(text,text,text) to service_role;

create or replace function public.meditation_human_gate_complete(
  p_mission_id text,
  p_device_id text,
  p_note text default null
)
returns jsonb
language sql
security definer
set search_path to pg_catalog, aria_internal
as $$
  select aria_internal.meditation_human_gate_complete(p_mission_id,p_device_id,p_note);
$$;

revoke all on function public.meditation_human_gate_complete(text,text,text) from public, anon, authenticated;
grant execute on function public.meditation_human_gate_complete(text,text,text) to service_role;

create or replace function aria_internal.aria_mission_finalize_verified_lease(
  p_mission_id text,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, aria_internal
as $$
declare
  r aria_internal.mission_state;
  gate jsonb;
begin
  if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_worker_id),'')='' then raise exception 'worker_id_required'; end if;

  select metadata->'human_gate' into gate
    from aria_internal.mission_state
   where mission_id=p_mission_id;

  if jsonb_typeof(gate)='object'
     and coalesce((gate->>'enabled')::boolean,false) is true
     and coalesce(btrim(gate->>'method'),'')<>''
     and not (
       coalesce((select checkpoint->'human_gate'->>'verified'
                   from aria_internal.mission_state
                  where mission_id=p_mission_id),'false')='true'
       and coalesce((select checkpoint->'human_gate'->>'status'
                   from aria_internal.mission_state
                  where mission_id=p_mission_id),'')='completed'
     ) then
    raise exception 'human_gate_required:completion_pending';
  end if;

  update aria_internal.mission_state m
     set status='succeeded',
         current_step=coalesce(m.total_steps,m.current_step),
         completed_steps=coalesce(m.total_steps,m.completed_steps),
         next_action=null,
         finished_at=coalesce(m.finished_at,clock_timestamp()),
         lease_owner=null,
         lease_until=null,
         checkpoint=jsonb_set(
           jsonb_set(
             jsonb_set(
               coalesce(m.checkpoint,'{}'::jsonb),
               '{universal_execution_verified}',
               'true'::jsonb,
               true
             ),
             '{agent_execution_verified}',
             to_jsonb(exists(select 1 from jsonb_array_elements(coalesce(m.checkpoint->'plan','[]'::jsonb)) s where coalesce(s->>'executor_type',s->'target'->>'type','')='agent')),
             true
           ),
           '{model_execution_verified}',
           to_jsonb(exists(select 1 from jsonb_array_elements(coalesce(m.checkpoint->'plan','[]'::jsonb)) s where coalesce(s->>'executor_type',s->'target'->>'type','')='model')),
           true
         ),
         updated_at=clock_timestamp()
   where m.mission_id=p_mission_id
     and m.lease_owner=p_worker_id
     and m.lease_until is not null
     and m.lease_until>clock_timestamp()
     and exists (
       select 1 from aria_internal.mission_events e
        where e.mission_id=p_mission_id
          and e.event_type='mission_verified'
          and coalesce((e.payload->>'verified')::boolean,false)=true
     )
     and coalesce(m.completed_steps,0)=coalesce(m.total_steps,0)
     and coalesce(m.total_steps,0)>0
   returning m.* into r;

  if not found then return null; end if;
  return to_jsonb(r);
end;
$$;
