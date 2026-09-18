-- Fast terminalization for missions whose semantic verification was already
-- recorded as a mission_verified event by the canonical runner.
create or replace function aria_internal.aria_mission_finalize_verified_lease(
  p_mission_id text,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r aria_internal.mission_state;
begin
  if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_worker_id),'')='' then raise exception 'worker_id_required'; end if;

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
       select 1
       from aria_internal.mission_events e
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
$function$;

revoke all on function aria_internal.aria_mission_finalize_verified_lease(text,text) from public,anon,authenticated;
grant execute on function aria_internal.aria_mission_finalize_verified_lease(text,text) to service_role;

create or replace function public.aria_mission_finalize_verified_lease(
  p_mission_id text,
  p_worker_id text
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog'
as $function$
  select aria_internal.aria_mission_finalize_verified_lease(p_mission_id,p_worker_id);
$function$;

revoke all on function public.aria_mission_finalize_verified_lease(text,text) from public,anon,authenticated;
grant execute on function public.aria_mission_finalize_verified_lease(text,text) to service_role;

comment on function aria_internal.aria_mission_finalize_verified_lease(text,text)
is 'Fast terminalization after canonical semantic verification: requires mission_verified=true and all steps completed, then only flips terminal mission state and releases lease.';
