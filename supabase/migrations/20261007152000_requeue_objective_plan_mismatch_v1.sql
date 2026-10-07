CREATE OR REPLACE FUNCTION aria_internal.requeue_objective_plan_mismatch_v1(p_mission_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal'
AS $$
DECLARE
  m aria_internal.mission_state;
BEGIN
  SELECT * INTO m
  FROM aria_internal.mission_state
  WHERE mission_id=p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mission_not_found';
  END IF;

  IF m.status <> 'blocked'
     OR coalesce(m.last_stderr,'') <> 'objective_plan_capability_mismatch'
     OR coalesce(m.metadata->>'goal_source','') <> 'user' THEN
    RAISE EXCEPTION 'mission_not_matching_objective_plan_mismatch';
  END IF;

  UPDATE aria_internal.mission_state
     SET status='queued',
         current_step=0,
         total_steps=null,
         completed_steps=0,
         attempt_count=0,
         next_action='replan: dedicated multi-project Reality Board planner',
         last_stderr=null,
         finished_at=null,
         lease_owner=null,
         lease_until=null,
         recovery_count=coalesce(recovery_count,0)+1,
         last_recovery_reason='objective_plan_mismatch_requeued_after_planner_fix',
         updated_at=clock_timestamp(),
         checkpoint=jsonb_set(
           jsonb_set(
             coalesce(checkpoint,'{}'::jsonb),
             '{objective_plan_guard,requeued_after_planner_fix}',
             'true'::jsonb,
             true
           ),
           '{recovery}',
           coalesce(checkpoint->'recovery','{}'::jsonb) ||
             jsonb_build_object(
               'status','replan_required',
               'replan_required',true,
               'reason','objective_plan_mismatch_requeued_after_planner_fix',
               'requeued_at',clock_timestamp()
             ),
           true
         ) - 'plan' - 'completed_steps' - 'attempts' - 'results' - 'pending_jobs' - 'last_batch' - 'last_executor_types'
   WHERE mission_id=p_mission_id;

  RETURN jsonb_build_object('mission_id',p_mission_id,'status','queued','requeued',true);
END;
$$;
