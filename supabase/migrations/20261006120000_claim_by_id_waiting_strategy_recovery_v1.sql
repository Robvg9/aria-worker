-- Reclaim waiting missions that are explicitly ready for a materially different strategy.
CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_by_id_lease(
  p_mission_id text,
  p_worker_id text,
  p_lease_for interval DEFAULT '00:02:00'::interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
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
         or (m.status in ('planning','running','paused') and m.lease_owner=p_worker_id and m.lease_until is not null and m.lease_until>clock_timestamp())
         or (m.status='running' and m.lease_owner is null)
         or (m.status='running' and m.lease_until is null)
         or (m.status='waiting'
             and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending'
             and (m.lease_owner is null or m.lease_until is null or m.lease_until<clock_timestamp()))
         or (m.status='waiting'
             and coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy'
             and coalesce((m.checkpoint->'recovery'->>'retry_ready')::boolean,false)=true
             and (m.lease_owner is null or m.lease_until is null or m.lease_until<clock_timestamp()))
       )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
       and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending','retry_exhausted'))
     for update skip locked
  ), updated as (
    update aria_internal.mission_state m
       set status='running',
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
             when m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending' then 'verification_pending_resumed'
             when m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy' then 'alternative_strategy_recovery_resumed'
             when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
             when m.status='paused' then 'explicit_resume_reclaimed'
             else m.last_recovery_reason
           end,
           next_action=case
             when m.status='failed' then 'replan: prior strategy failed'
             when m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending' then 'verification:resume_pending_verification'
             when m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy' then 'next_ready_batch'
             else m.next_action
           end,
           checkpoint=aria_internal.aria_materialize_human_gate_approval(m.checkpoint)
      from candidate c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;