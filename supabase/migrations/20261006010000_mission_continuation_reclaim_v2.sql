-- ARIA mission continuation recovery v2
-- Do not leave a recently completed batch stranded just because its explicit
-- pg_net continuation request was not processed. A mission may be reclaimed
-- when it is unleased, asks for next_ready_batch, has no pending device jobs,
-- has no active_step, and has passed a short duplicate-execution grace period.

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_next_lease(
  p_worker_id text,
  p_lease_for interval default '00:02:00'::interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path to 'pg_catalog', 'aria_internal'
AS $function$
declare
  claimed jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception 'worker_id_required';
  end if;

  with candidates as (
    select m.mission_id
      from aria_internal.mission_state m
     where (
       m.status='queued'
       or (m.status in ('planning','running','paused','failed')
           and m.lease_until is not null
           and m.lease_until<clock_timestamp())
       or (m.status='running'
           and (m.lease_owner is null or m.lease_until is null)
           and coalesce(m.next_action,'')='next_ready_batch'
           and m.updated_at <= clock_timestamp()-interval '30 seconds'
           and coalesce(m.checkpoint->'active_step','null'::jsonb)='null'::jsonb
           and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb)
       or (m.status='running'
           and (m.lease_owner is null or m.lease_until is null)
           and coalesce(m.next_action,'')<>'next_ready_batch')
       or (m.status='paused'
           and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       or (m.status='waiting'
           and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
     order by
       case lower(coalesce(m.metadata->>'execution_lane',''))
         when 'primary' then 0
         when 'repair' then 10
         when 'user' then 20
         when 'meditation' then 30
         when 'idea' then 90
         when 'test' then 100
         else 50
       end,
       case m.status
         when 'queued' then 0
         when 'waiting' then 1
         when 'planning' then 2
         when 'paused' then 3
         when 'running' then 4
         when 'failed' then 5
         else 9
       end,
       case when m.status='queued' then coalesce((m.metadata->>'queue_priority')::numeric,0) else 0 end desc,
       m.updated_at,
       m.created_at,
       m.mission_id
     for update skip locked
     limit 1
  ), updated as (
    update aria_internal.mission_state m
       set status=case
         when m.status in ('queued','failed') then 'planning'
         when m.status='waiting' then 'running'
         else 'running'
       end,
       lease_owner=p_worker_id,
       lease_until=clock_timestamp()+p_lease_for,
       updated_at=clock_timestamp(),
       current_workspace=coalesce(m.current_workspace,p_worker_id),
       recovery_count=case
         when m.status='paused' then coalesce(m.recovery_count,0)+1
         when m.status in ('planning','running','failed')
           and m.lease_until is not null
           and m.lease_until<clock_timestamp()
           then coalesce(m.recovery_count,0)+1
         else coalesce(m.recovery_count,0)
       end,
       last_recovery_reason=case
         when m.status='failed' then 'failed_mission_replanned'
         when m.status='waiting' then 'verification_pending_resumed'
         when m.status='paused' then 'paused_pending_job_reclaimed'
         when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
         when m.status='running' and m.lease_owner is null then 'next_ready_batch_reclaimed'
         when m.status='running' and m.lease_until is null then 'next_ready_batch_reclaimed'
         else m.last_recovery_reason
       end,
       next_action=case
         when m.status='failed' then 'replan: prior strategy failed'
         when m.status='waiting' then 'verification:resume_pending_verification'
         else m.next_action
       end
      from candidates c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;