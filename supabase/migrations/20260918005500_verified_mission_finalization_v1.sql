-- Canonical terminal path for missions already verified by the universal runner.
-- The generic lease update performs broad semantic verification and returns the
-- entire row. Terminalization needs a compact, explicitly verified path so the
-- Edge RPC does not time out after a successful mission.
create or replace function aria_internal.aria_mission_finalize_verified_lease_v1(
  p_mission_id text,
  p_worker_id text,
  p_checkpoint jsonb,
  p_total_steps integer,
  p_finished_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'aria_internal'
set statement_timeout = '15s'
as $function$
declare
  r aria_internal.mission_state;
  v_plan jsonb;
  v_results jsonb;
  v_step jsonb;
  v_step_id text;
  v_verified_count integer := 0;
  v_step_count integer := 0;
begin
  if coalesce(btrim(p_mission_id),'')='' then
    raise exception 'mission_id_required';
  end if;
  if coalesce(btrim(p_worker_id),'')='' then
    raise exception 'worker_id_required';
  end if;
  if p_total_steps is null or p_total_steps < 1 then
    raise exception 'total_steps_required';
  end if;

  select *
    into r
    from aria_internal.mission_state
   where mission_id=p_mission_id
   for update;

  if not found then
    raise exception 'mission_not_found';
  end if;
  if r.lease_owner is distinct from p_worker_id
     or r.lease_until is null
     or r.lease_until <= clock_timestamp() then
    raise exception 'mission_lease_lost';
  end if;

  if not exists (
    select 1
      from aria_internal.mission_events e
     where e.mission_id=p_mission_id
       and e.event_type='mission_verified'
       and coalesce(e.payload->>'verified','false')='true'
       and e.created_at >= r.updated_at - interval '10 minutes'
  ) then
    raise exception 'mission_verified_evidence_missing';
  end if;

  v_plan := coalesce(p_checkpoint->'plan','[]'::jsonb);
  v_results := coalesce(p_checkpoint->'results','{}'::jsonb);

  if jsonb_typeof(v_plan)<>'array' or jsonb_array_length(v_plan)<>p_total_steps then
    raise exception 'verified_plan_mismatch';
  end if;
  if jsonb_typeof(v_results)<>'object' then
    raise exception 'verified_results_missing';
  end if;

  for v_step in select value from jsonb_array_elements(v_plan) loop
    v_step_count := v_step_count + 1;
    v_step_id := v_step->>'id';
    if coalesce(v_step_id,'')='' then
      raise exception 'verified_step_id_missing';
    end if;
    if coalesce(v_results->v_step_id->>'status','')<>'succeeded' then
      raise exception 'verified_step_not_succeeded:%', v_step_id;
    end if;
    v_verified_count := v_verified_count + 1;
  end loop;

  if v_verified_count<>p_total_steps then
    raise exception 'verified_step_count_mismatch';
  end if;

  update aria_internal.mission_state
     set status='succeeded',
         current_step=p_total_steps,
         total_steps=p_total_steps,
         completed_steps=p_total_steps,
         next_action=null,
         finished_at=coalesce(p_finished_at,clock_timestamp()),
         lease_owner=null,
         lease_until=null,
         last_stderr=null,
         updated_at=clock_timestamp(),
         checkpoint=p_checkpoint
   where mission_id=p_mission_id
     and lease_owner=p_worker_id
     and lease_until is not null
     and lease_until>clock_timestamp()
   returning * into r;

  if not found then
    raise exception 'mission_lease_lost';
  end if;

  return jsonb_build_object(
    'mission_id',r.mission_id,
    'status',r.status,
    'completed_steps',r.completed_steps,
    'finished_at',r.finished_at,
    'updated_at',r.updated_at,
    'verified_steps',v_verified_count
  );
end;
$function$;

create or replace function public.aria_mission_finalize_verified_lease_v1(
  p_mission_id text,
  p_worker_id text,
  p_checkpoint jsonb,
  p_total_steps integer,
  p_finished_at timestamptz default clock_timestamp()
)
returns jsonb
language sql
security definer
set search_path = 'pg_catalog'
as $$
  select aria_internal.aria_mission_finalize_verified_lease_v1(
    p_mission_id,
    p_worker_id,
    p_checkpoint,
    p_total_steps,
    p_finished_at
  );
$$;

revoke all on function public.aria_mission_finalize_verified_lease_v1(text,text,jsonb,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.aria_mission_finalize_verified_lease_v1(text,text,jsonb,integer,timestamptz) to service_role;

comment on function public.aria_mission_finalize_verified_lease_v1(text,text,jsonb,integer,timestamptz)
is 'Governed terminalization path for missions whose runner has emitted mission_verified. Uses compact verification and bounded DB statement timeout.';
