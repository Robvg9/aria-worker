-- Mission recovery consistency: a mission explicitly requeued for replanning
-- must not retain the terminal retry_exhausted marker that blocks claim_by_id.
create or replace function aria_internal.aria_autonomy_recover_stale_missions(
  p_stale_after interval default '00:02:00'::interval
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  n integer;
begin
  update aria_internal.mission_state
  set
    status = case when recovery_count >= 3 then 'failed' else 'queued' end,
    lease_owner = null,
    lease_until = null,
    current_step = case
      when status='failed' or recovery_count>=3 then 0
      else greatest(0,coalesce(current_step,0))
    end,
    completed_steps = case
      when status='failed' or recovery_count>=3 then 0
      else completed_steps
    end,
    attempt_count = case
      when status='failed' or recovery_count>=3 then 0
      else attempt_count
    end,
    next_action = case
      when recovery_count>=3 then 'replan: recovery exhausted after stale mission'
      when status='failed' then 'replan: prior strategy failed'
      else 'recovered: resume'
    end,
    last_stderr = case
      when recovery_count>=3 then coalesce(last_stderr,'recovery_exhausted_after_stale_mission')
      when status='failed' then coalesce(last_stderr,'prior_strategy_failed')
      else 'stale_mission_recovered_automatically'
    end,
    recovery_count = case
      when recovery_count>=3 then 0
      else coalesce(recovery_count,0)+1
    end,
    last_recovery_reason = case
      when recovery_count>=3 then 'recovery_exhausted_replan'
      when status='failed' then 'failed_strategy_replan'
      else 'stale_timeout'
    end,
    updated_at = clock_timestamp(),
    finished_at = null,
    checkpoint = case
      when status='failed' or recovery_count>=3 then
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(checkpoint,'{}'::jsonb),
              '{recovery,previous_plan}',
              coalesce(checkpoint->'plan','[]'::jsonb),
              true
            ),
            '{recovery,replan_required}',
            'true'::jsonb,
            true
          ),
          '{recovery,status}',
          '"replan_required"'::jsonb,
          true
        )
        - 'plan' - 'completed_steps' - 'attempts' - 'results' - 'pending_jobs'
      else checkpoint
    end
  where status in ('planning','running','paused','failed')
    and updated_at < clock_timestamp()-p_stale_after
    and (lease_until is null or lease_until < clock_timestamp())
    and not (
      coalesce(checkpoint->'recovery'->>'status','')
      in ('waiting_for_human_gate','human_gate_pending')
    );

  get diagnostics n=row_count;
  return n;
end;
$function$;

comment on function aria_internal.aria_autonomy_recover_stale_missions(interval)
is 'Requeue stale/failed missions for replanning without retaining the retry_exhausted claim-block marker.';
