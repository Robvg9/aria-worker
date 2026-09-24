-- Ordered Meditación IA queue
-- Queue priority is stored in mission_state.metadata so the existing schema remains compatible.

create or replace function aria_internal.aria_mission_claim_next_lease(
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
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception 'worker_id_required';
  end if;

  with candidates as (
    select m.mission_id
      from aria_internal.mission_state m
     where (
       m.status='queued'
       or (m.status in ('planning','running','paused','failed') and m.lease_until is not null and m.lease_until<clock_timestamp())
       or (m.status='running' and m.lease_owner is null)
       or (m.status='running' and m.lease_until is null)
       or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
     order by
       case
         when m.status='queued' and coalesce(m.metadata->>'queue_priority','') ~ '^-?[0-9]+$'
           then (m.metadata->>'queue_priority')::bigint
         else 0
       end desc,
       case when m.status='queued' then m.created_at end asc nulls last,
       m.updated_at asc,
       m.mission_id asc
     for update skip locked
     limit 1
  ), updated as (
    update aria_internal.mission_state m
       set status=case when m.status in ('queued','failed') then 'planning' else 'running' end,
           lease_owner=p_worker_id,
           lease_until=clock_timestamp()+p_lease_for,
           updated_at=clock_timestamp(),
           current_workspace=coalesce(m.current_workspace,p_worker_id),
           recovery_count=case
             when m.status='paused' then coalesce(m.recovery_count,0)+1
             when m.status in ('planning','running','failed') and m.lease_until is not null and m.lease_until<clock_timestamp()
               then coalesce(m.recovery_count,0)+1
             else coalesce(m.recovery_count,0)
           end,
           last_recovery_reason=case
             when m.status='failed' then 'failed_mission_replanned'
             when m.status='waiting' then 'verification_pending_resumed'
             when m.status='paused' then 'paused_pending_job_reclaimed'
             when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
             else m.last_recovery_reason
           end,
           next_action=case
             when m.status='failed' then 'replan: prior strategy failed'
             when m.status='waiting' then 'verification:resume_pending_verification'
             when m.status='paused' then 'resume: pending execution job'
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
      from candidates c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;
