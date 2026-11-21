CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_by_id_lease(
  p_mission_id text,
  p_worker_id text,
  p_lease_for interval DEFAULT '00:15:00'::interval
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

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_queue_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
with q as (
  select m.mission_id,
         coalesce(m.metadata->>'goal_id','') as goal_id,
         coalesce(m.checkpoint->'recovery'->>'status','') as recovery_status,
         coalesce(m.checkpoint->'recovery'->>'replan_required','') as replan_required,
         g.status as goal_status,
         g.objective_verification_status,
         g.last_mission_id,
         g.metadata->'dependencies' as dependencies
    from aria_internal.mission_state m
    left join aria_internal.autonomy_goals g
      on g.goal_id=coalesce(m.metadata->>'goal_id','')
   where m.status='queued'
),
classified as (
 select q.*,
        aria_internal.aria_mission_claim_eligible(q.mission_id) as eligible,
        case
          when q.recovery_status='retry_exhausted' then 'retry_exhausted'
          when q.goal_id<>'' and q.goal_status is null then 'missing_goal'
          when q.goal_id<>'' and q.objective_verification_status='DUPLICATE_HISTORICAL' then 'historical_duplicate'
          when q.goal_id<>'' and q.goal_status='completed' then 'terminal_goal'
          when q.goal_id<>'' and q.last_mission_id is distinct from q.mission_id then 'stale_goal_pointer'
          when q.goal_id<>'' and q.goal_status='blocked' then 'blocked_goal_requires_replan'
          when not aria_internal.aria_mission_claim_eligible(q.mission_id) and jsonb_array_length(coalesce(q.dependencies,'[]'::jsonb))>0 then 'dependency_wait'
          when not aria_internal.aria_mission_claim_eligible(q.mission_id) then 'other_governance_block'
          else 'eligible'
        end as reason
   from q
)
select jsonb_build_object(
  'version','v1',
  'checked_at',clock_timestamp(),
  'queued_total',count(*),
  'eligible',count(*) filter(where reason='eligible'),
  'dependency_wait',count(*) filter(where reason='dependency_wait'),
  'retry_exhausted',count(*) filter(where reason='retry_exhausted'),
  'stale_goal_pointer',count(*) filter(where reason='stale_goal_pointer'),
  'blocked_goal_requires_replan',count(*) filter(where reason='blocked_goal_requires_replan'),
  'historical_duplicate',count(*) filter(where reason='historical_duplicate'),
  'terminal_goal',count(*) filter(where reason='terminal_goal'),
  'missing_goal',count(*) filter(where reason='missing_goal'),
  'other_governance_block',count(*) filter(where reason='other_governance_block')
)
from classified;
$function$;
