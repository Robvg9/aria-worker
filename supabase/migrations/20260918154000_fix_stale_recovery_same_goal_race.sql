create or replace function aria_internal.aria_autonomy_recover_stale_missions(p_stale_after interval default '00:02:00'::interval)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  n integer := 0;
  n_conflict integer := 0;
  n_recovered integer := 0;
begin
  -- Phase 1: stale missions whose goal already has another inflight mission
  -- are failed/replanned. This cannot create duplicate inflight rows.
  update aria_internal.mission_state m
     set status='failed',
         lease_owner=null,
         lease_until=null,
         current_step=0,
         completed_steps=0,
         attempt_count=0,
         next_action='replan: duplicate inflight goal prevented',
         last_stderr='duplicate_inflight_goal_prevented_during_stale_recovery',
         recovery_count=coalesce(m.recovery_count,0)+1,
         last_recovery_reason='duplicate_inflight_goal_prevented',
         updated_at=clock_timestamp(),
         finished_at=null,
         checkpoint=jsonb_set(
           jsonb_set(
             jsonb_set(
               coalesce(m.checkpoint,'{}'::jsonb),
               '{recovery,previous_plan}',
               coalesce(m.checkpoint->'plan','[]'::jsonb),
               true
             ),
             '{recovery,replan_required}',
             'true'::jsonb,
             true
           ),
           '{recovery,status}',
           '"replan_required"'::jsonb,
           true
         ) - 'plan' - 'completed_steps' - 'attempts' - 'results' - 'pending_jobs'
   where m.status in ('planning','running','paused','failed')
     and m.updated_at < clock_timestamp()-p_stale_after
     and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending'))
     and nullif(m.metadata->>'goal_id','') is not null
     and exists (
       select 1
         from aria_internal.mission_state other
        where other.mission_id<>m.mission_id
          and other.status in ('queued','planning','running','waiting','paused')
          and nullif(other.metadata->>'goal_id','') = nullif(m.metadata->>'goal_id','')
     );
  get diagnostics n_conflict=row_count;

  -- Phase 2: recover at most ONE stale/retry-exhausted mission per goal.
  -- The old implementation evaluated NOT EXISTS against the same statement
  -- snapshot, so two rows for one goal could both become queued and collide
  -- with mission_state_one_inflight_goal_idx. Rank first, then update only rn=1.
  with candidates as (
    select m.mission_id,
           row_number() over (
             partition by nullif(m.metadata->>'goal_id','')
             order by m.created_at desc,m.mission_id desc
           ) as rn
      from aria_internal.mission_state m
     where (
       (m.status in ('planning','running','paused','failed')
        and m.updated_at < clock_timestamp()-p_stale_after)
       or
       (m.status='queued'
        and coalesce(m.checkpoint->'recovery'->>'status','')='retry_exhausted')
     )
       and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending'))
       and nullif(m.metadata->>'goal_id','') is not null
       and not exists (
         select 1
           from aria_internal.mission_state other
          where other.mission_id<>m.mission_id
            and other.status in ('queued','planning','running','waiting','paused')
            and nullif(other.metadata->>'goal_id','') = nullif(m.metadata->>'goal_id','')
       )
  ),
  selected as (
    select mission_id from candidates where rn=1
  )
  update aria_internal.mission_state m
     set status=case when m.recovery_count >= 3 then 'failed' else 'queued' end,
         lease_owner=null,
         lease_until=null,
         current_step=case
           when m.status='failed' or m.recovery_count>=3 then 0
           else greatest(0,coalesce(m.current_step,0))
         end,
         completed_steps=case
           when m.status='failed' or m.recovery_count>=3 then 0
           else m.completed_steps
         end,
         attempt_count=case
           when m.status='failed' or m.recovery_count>=3 then 0
           else m.attempt_count
         end,
         next_action=case
           when m.recovery_count>=3 then 'replan: recovery exhausted after stale mission'
           when m.status='failed' then 'replan: prior strategy failed'
           else 'recovered: resume'
         end,
         last_stderr=case
           when m.recovery_count>=3 then coalesce(m.last_stderr,'recovery_exhausted_after_stale_mission')
           when m.status='failed' then coalesce(m.last_stderr,'prior_strategy_failed')
           else 'stale_mission_recovered_automatically'
         end,
         recovery_count=case when m.recovery_count>=3 then 0 else coalesce(m.recovery_count,0)+1 end,
         last_recovery_reason=case
           when m.recovery_count>=3 then 'recovery_exhausted_replan'
           when m.status='failed' then 'failed_strategy_replan'
           else 'stale_timeout'
         end,
         updated_at=clock_timestamp(),
         finished_at=null,
         checkpoint=case
           when m.status='failed'
             or m.recovery_count>=3
             or (m.status='queued' and coalesce(m.checkpoint->'recovery'->>'status','')='retry_exhausted')
           then jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(m.checkpoint,'{}'::jsonb),
                 '{recovery,previous_plan}',
                 coalesce(m.checkpoint->'plan','[]'::jsonb),
                 true
               ),
               '{recovery,replan_required}',
               'true'::jsonb,
               true
             ),
             '{recovery,status}',
             '"replan_required"'::jsonb,
             true
           ) - 'plan' - 'completed_steps' - 'attempts' - 'results' - 'pending_jobs'
           else m.checkpoint
         end
    where m.mission_id in (select mission_id from selected);
  get diagnostics n_recovered=row_count;

  n:=n_conflict+n_recovered;
  return n;
end;
$function$;
