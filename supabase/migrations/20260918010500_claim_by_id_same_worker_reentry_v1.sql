-- Mission chaining: allow the same governed worker to re-enter a mission
-- it already claimed. This closes the claim-twice gap in immediate chaining.
create or replace function aria_internal.aria_mission_claim_by_id_lease(
  p_mission_id text,
  p_worker_id text,
  p_lease_for interval default '00:02:00'::interval
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare claimed jsonb;
begin
  if p_mission_id is null or btrim(p_mission_id)='' then
    raise exception 'mission_id_required';
  end if;
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception 'worker_id_required';
  end if;

  with candidate as (
    select m.mission_id
      from aria_internal.mission_state m
     where m.mission_id=p_mission_id
       and (
         m.status='queued'
         or (m.status in ('paused','failed') and (m.lease_until is null or m.lease_until<clock_timestamp()))
         or (m.status in ('planning','running') and m.lease_until is not null and m.lease_until<clock_timestamp())
         or (m.status in ('planning','running','paused')
             and m.lease_owner=p_worker_id
             and m.lease_until is not null
             and m.lease_until>clock_timestamp())
       )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
       and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending','retry_exhausted'))
     for update skip locked
  ), updated as (
    update aria_internal.mission_state m
       set status=case when m.status in ('queued','failed') then 'planning' else m.status end,
           lease_owner=p_worker_id,
           lease_until=clock_timestamp()+p_lease_for,
           updated_at=clock_timestamp(),
           current_workspace=coalesce(m.current_workspace,p_worker_id),
           recovery_count=case
             when m.lease_until is not null and m.lease_until<clock_timestamp()
               then coalesce(m.recovery_count,0)+1
             else coalesce(m.recovery_count,0)
           end,
           last_recovery_reason=case
             when m.status='failed' then 'failed_mission_replanned'
             when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
             when m.status in ('paused','failed') then 'explicit_resume_reclaimed'
             else m.last_recovery_reason
           end,
           next_action=case
             when m.status='failed' then 'replan: prior strategy failed'
             else m.next_action
           end,
           checkpoint=aria_internal.aria_materialize_human_gate_approval(
             case when m.status='failed'
               then jsonb_set(
                 jsonb_set(coalesce(m.checkpoint,'{}'::jsonb),'{recovery,previous_plan}',coalesce(m.checkpoint->'plan','[]'::jsonb),true),
                 '{recovery,replan_required}','true'::jsonb,true
               )-'plan'-'completed_steps'-'attempts'-'results'-'pending_jobs'
               else m.checkpoint
             end
           )
      from candidate c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;

create or replace function public.aria_mission_claim_by_id_lease(
  p_mission_id text,
  p_worker_id text,
  p_lease_for interval default '00:02:00'::interval
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog'
as $function$
  select aria_internal.aria_mission_claim_by_id_lease(p_mission_id,p_worker_id,p_lease_for);
$function$;

revoke all on function public.aria_mission_claim_by_id_lease(text,text,interval) from public,anon,authenticated;
grant execute on function public.aria_mission_claim_by_id_lease(text,text,interval) to service_role;

comment on function aria_internal.aria_mission_claim_by_id_lease(text,text,interval)
is 'Atomic mission claim with same-worker re-entry for immediate governed chaining.';
