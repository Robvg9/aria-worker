alter table aria_internal.mission_events drop constraint if exists mission_events_event_type_check;

alter table aria_internal.mission_events
  add constraint mission_events_event_type_check check (
    event_type = any (array[
      'mission_created',
      'mission_queued',
      'mission_planning',
      'mission_started',
      'mission_running',
      'step_started',
      'step_succeeded',
      'step_failed',
      'mission_waiting',
      'mission_blocked',
      'mission_paused',
      'mission_resumed',
      'mission_succeeded',
      'mission_failed',
      'mission_cancelled',
      'checkpoint_saved',
      'agent_heartbeat',
      'human_gate_requested',
      'mission_verified',
      'mission_dead_lettered',
      'cognitive_recall_completed',
      'cognitive_planning_context_used',
      'cognitive_loop_completed'
    ])
  );
