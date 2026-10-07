-- Replan function must tolerate user missions without a linked autonomy goal.
CREATE OR REPLACE FUNCTION aria_internal.replan_existing_mission_v1(p_mission_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare
  m aria_internal.mission_state;
  g aria_internal.autonomy_goals;
  gid text;
  hist jsonb;
begin
  select * into m
  from aria_internal.mission_state
  where mission_id=p_mission_id
  for update;

  if not found then
    raise exception 'mission_not_found';
  end if;

  gid:=nullif(m.metadata->>'goal_id','');

  if gid is not null then
    select * into g
    from aria_internal.autonomy_goals
    where goal_id=gid
    for update;

    if not found then
      raise exception 'goal_not_found';
    end if;

    if g.objective_verification_status in ('BLOCKED_LEGITIMATE','DUPLICATE_HISTORICAL') then
      raise exception 'objective_not_replanable:%',g.objective_verification_status;
    end if;
  end if;

  if m.status not in ('blocked','failed','paused','waiting','queued') then
    raise exception 'mission_not_replanable:%',m.status;
  end if;

  hist:=jsonb_build_object(
    'recorded_at',clock_timestamp(),
    'prior_status',m.status,
    'prior_attempt_count',m.attempt_count,
    'prior_next_action',m.next_action,
    'prior_stderr',m.last_stderr,
    'prior_recovery',coalesce(m.checkpoint->'recovery','{}'::jsonb),
    'prior_plan',coalesce(m.checkpoint->'plan','[]'::jsonb),
    'prior_results',coalesce(m.checkpoint->'results','{}'::jsonb)
  );

  update aria_internal.mission_state
  set status='queued',
      current_step=0,
      total_steps=null,
      completed_steps=0,
      attempt_count=0,
      next_action='replan: materialize fresh governed plan before claim',
      last_exit_code=null,
      last_stdout=null,
      last_stderr=null,
      finished_at=null,
      lease_owner=null,
      lease_until=null,
      checkpoint=(
        coalesce(m.checkpoint,'{}'::jsonb)
        - 'plan' - 'results' - 'completed_steps' - 'attempts' - 'pending_jobs'
        - 'last_batch' - 'last_executor_types'
        || jsonb_build_object(
          'replan_history',
          coalesce(m.checkpoint->'replan_history','[]'::jsonb) || jsonb_build_array(hist),
          'replan',
          jsonb_build_object(
            'version','v3',
            'reason','objective_repair',
            'materialize_before_claim',true,
            'goal_linked',gid is not null,
            'requested_at',clock_timestamp()
          )
        )
      )
  where mission_id=p_mission_id;

  if gid is not null then
    update aria_internal.autonomy_goals
    set status='queued',
        objective_verification_status=case
          when objective_verification_status='CONFIRMED' then 'UNVERIFIED'
          else coalesce(objective_verification_status,'UNVERIFIED')
        end,
        objective_verification_reason='Objective explicitly re-planned using the existing mission identity; previous attempt retained as forensic history.',
        objective_verified_at=null,
        next_run_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where goal_id=gid;
  end if;

  return jsonb_build_object(
    'mission_id',p_mission_id,
    'goal_id',gid,
    'status','queued',
    'replanned',true,
    'replan_version','v3',
    'goal_linked',gid is not null
  );
end;
$function$;
