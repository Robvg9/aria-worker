ALTER TABLE aria_internal.mission_events DROP CONSTRAINT IF EXISTS mission_events_event_type_check;
ALTER TABLE aria_internal.mission_events ADD CONSTRAINT mission_events_event_type_check CHECK (event_type = ANY (ARRAY['mission_created'::text, 'mission_queued'::text, 'mission_planning'::text, 'mission_started'::text, 'mission_running'::text, 'step_started'::text, 'step_succeeded'::text, 'step_failed'::text, 'step_retrying'::text, 'step_batch_started'::text, 'executor_selected'::text, 'execution_started'::text, 'execution_completed'::text, 'execution_failed'::text, 'execution_timeout'::text, 'mission_waiting'::text, 'mission_blocked'::text, 'mission_paused'::text, 'mission_resumed'::text, 'mission_succeeded'::text, 'mission_failed'::text, 'mission_cancelled'::text, 'checkpoint_saved'::text, 'agent_heartbeat'::text, 'human_gate_requested'::text, 'human_gate_approved'::text, 'human_gate_rejected'::text, 'human_gate_cancelled'::text, 'human_gate_consumed'::text, 'self_improvement_human_gate'::text, 'human_gate_completed'::text, 'recovery_attempted'::text, 'mission_verified'::text, 'mission_dead_lettered'::text, 'cognitive_recall_completed'::text, 'cognitive_planning_context_used'::text, 'cognitive_loop_completed'::text, 'agent_executor_diagnostic'::text, 'mission_chain_completed'::text, 'planner_failed'::text, 'learning_preflight_blocked'::text, 'mission_replanned'::text, 'mission_hard_blocked'::text, 'computer_use_capabilities_confirmed'::text, 'computer_use_device_confirmed'::text, 'computer_use_observation_started'::text, 'computer_use_observation_completed'::text, 'computer_use_decision_made'::text, 'computer_use_action_started'::text, 'computer_use_action_executed'::text, 'computer_use_result_observed'::text, 'computer_use_verification_completed'::text, 'computer_use_action_blocked'::text, 'computer_use_route_navigation_completed'::text, 'device_target_resolved'::text, 'mission_alternative_strategy_needed'::text, 'hard_blocks_reopened'::text, 'mission_verification_retry_requested'::text, 'mission_verification_failed'::text]));

CREATE OR REPLACE FUNCTION public.aria_mission_append_event_lease(p_mission_id text, p_worker_id text, p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare r aria_internal.mission_events;
declare v_payload jsonb := coalesce(p_event->'payload','{}'::jsonb);
begin
  if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_worker_id),'')='' then raise exception 'worker_id_required'; end if;
  if not exists(
    select 1 from aria_internal.mission_state
    where mission_id=p_mission_id
      and lease_owner=p_worker_id
      and lease_until is not null
      and lease_until>clock_timestamp()
  ) then raise exception 'mission_lease_required'; end if;
  insert into aria_internal.mission_events(
    mission_id,step_index,event_type,payload,trace_id,span_id,request_id,execution_id,error_code,runtime_version,source_sha
  )
  values(
    p_mission_id,
    case when p_event ? 'step_index' and p_event->>'step_index' is not null then (p_event->>'step_index')::integer else null end,
    coalesce(p_event->>'event_type','event'),
    v_payload,
    coalesce(p_event->>'trace_id',v_payload->>'trace_id'),
    coalesce(p_event->>'span_id',v_payload->>'span_id'),
    coalesce(p_event->>'request_id',v_payload->>'request_id'),
    coalesce(p_event->>'execution_id',v_payload->>'execution_id'),
    coalesce(p_event->>'error_code',v_payload->>'error_code'),
    coalesce(p_event->>'runtime_version',v_payload->>'runtime_version'),
    coalesce(p_event->>'source_sha',v_payload->>'source_sha')
  )
  returning * into r;
  return to_jsonb(r);
end;
$function$;