-- ARIA Mission Verification Recovery v1
-- Keep external verification pending missions recoverable instead of terminally blocked.

create or replace function aria_internal.aria_mission_claim_eligible(p_mission_id text)
returns boolean
language sql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
select exists (
  select 1
    from aria_internal.mission_state m
    left join aria_internal.autonomy_goals g
      on g.goal_id=coalesce(m.metadata->>'goal_id','')
    left join aria_internal.vision_objectives v
      on v.objective_id=coalesce(g.metadata->>'vision_objective_id','')
   where m.mission_id=p_mission_id
     and m.status in ('queued','failed','paused','planning','running','waiting')
     and coalesce(m.checkpoint->'recovery'->>'status','') not in (
       'waiting_for_human_gate','human_gate_pending','retry_exhausted'
     )
     and (
       m.status <> 'waiting'
       or coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending'
     )
     and not (
       m.status='failed'
       and coalesce(m.last_recovery_reason,'')='failed_mission_replanned'
       and coalesce(m.recovery_count,0)>=3
       and coalesce(m.checkpoint->'recovery'->>'failure_reason','')='coordinator_test_evidence_missing'
     )
     and (
       g.goal_id is null
       or (
         coalesce(g.objective_verification_status,'UNVERIFIED')<>'DUPLICATE_HISTORICAL'
         and coalesce(g.status,'')<>'completed'
         and (g.last_mission_id is null or g.last_mission_id=m.mission_id)
         and (
           coalesce(g.status,'')<>'blocked'
           or (
             g.last_mission_id=m.mission_id
             and (
               coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
               or coalesce(m.metadata->>'replan_required','')='true'
               or coalesce(m.metadata->>'resume_blocked_goal','')='true'
             )
           )
         )
         and (
           v.objective_id is null
           or v.status<>'completed'
           or coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
           or coalesce(m.metadata->>'replan_required','')='true'
           or coalesce(m.metadata->>'resume_blocked_goal','')='true'
         )
         and (
           jsonb_array_length(coalesce(g.metadata->'dependencies','[]'::jsonb))=0
           or not exists (
             select 1
               from jsonb_array_elements_text(coalesce(g.metadata->'dependencies','[]'::jsonb)) d(dep_id)
               left join aria_internal.autonomy_goals dep
                 on dep.goal_id=aria_internal.resolve_dependency_goal_id(d.dep_id)
              where dep.goal_id is null
                 or dep.status<>'completed'
                 or dep.objective_verification_status<>'CONFIRMED'
           )
         )
       )
     )
);
$function$;

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
       or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
     order by m.updated_at,m.created_at,m.mission_id
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
           checkpoint=aria_internal.aria_materialize_human_gate_approval(m.checkpoint)
      from candidates c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;

create or replace function public.aria_mission_claim_next_lease(
  p_worker_id text,
  p_lease_for interval default '00:02:00'::interval
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $$
  select aria_internal.aria_mission_claim_next_lease(p_worker_id,p_lease_for);
$$;

revoke all on function public.aria_mission_claim_next_lease(text,interval) from public,anon,authenticated;
grant execute on function public.aria_mission_claim_next_lease(text,interval) to service_role;

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
         or (m.status='waiting'
             and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending'
             and (m.lease_owner is null or m.lease_until is null or m.lease_until<clock_timestamp()))
       )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
       and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending','retry_exhausted'))
     for update skip locked
  ), updated as (
    update aria_internal.mission_state m
       set status=case when m.status in ('queued','failed') then 'planning' else 'running' end,
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
             when m.status='waiting' then 'verification_pending_resumed'
             when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
             when m.status='paused' then 'explicit_resume_reclaimed'
             else m.last_recovery_reason
           end,
           next_action=case
             when m.status='failed' then 'replan: prior strategy failed'
             when m.status='waiting' then 'verification:resume_pending_verification'
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
as $$
  select aria_internal.aria_mission_claim_by_id_lease(p_mission_id,p_worker_id,p_lease_for);
$$;

revoke all on function public.aria_mission_claim_by_id_lease(text,text,interval) from public,anon,authenticated;
grant execute on function public.aria_mission_claim_by_id_lease(text,text,interval) to service_role;

comment on function aria_internal.aria_mission_claim_eligible(text)
is 'Mission claim gate including recoverable external-verification waits.';
comment on function aria_internal.aria_mission_claim_next_lease(text,interval)
is 'Universal mission claim with recoverable verification-pending state.';
comment on function aria_internal.aria_mission_claim_by_id_lease(text,text,interval)
is 'Atomic mission claim including recoverable verification-pending state.';
