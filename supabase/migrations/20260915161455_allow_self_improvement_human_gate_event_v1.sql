alter table aria_internal.mission_events drop constraint if exists mission_events_event_type_check;
alter table aria_internal.mission_events add constraint mission_events_event_type_check check (event_type = any (array[
  'mission_created','mission_queued','mission_planning','mission_started','mission_running',
  'step_started','step_succeeded','step_failed','step_retrying','step_batch_started',
  'executor_selected','execution_started','execution_completed','execution_failed','execution_timeout',
  'mission_waiting','mission_blocked','mission_paused','mission_resumed','mission_succeeded','mission_failed','mission_cancelled',
  'checkpoint_saved','agent_heartbeat','human_gate_requested','self_improvement_human_gate','recovery_attempted',
  'mission_verified','mission_dead_lettered','cognitive_recall_completed','cognitive_planning_context_used','cognitive_loop_completed'
]));