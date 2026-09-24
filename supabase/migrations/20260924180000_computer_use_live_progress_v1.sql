-- Computer Use live progress events v1.
-- Windows autonomous Computer Use emits fine-grained evidence into the canonical mission event stream.
-- The gateway validates job/device ownership before persisting these events.

ALTER TABLE aria_internal.mission_events
  DROP CONSTRAINT IF EXISTS mission_events_event_type_check;

ALTER TABLE aria_internal.mission_events
  ADD CONSTRAINT mission_events_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'mission_created','mission_queued','mission_planning','mission_started','mission_running',
      'step_started','step_succeeded','step_failed','step_retrying','step_batch_started',
      'executor_selected','execution_started','execution_completed','execution_failed','execution_timeout',
      'mission_waiting','mission_blocked','mission_paused','mission_resumed','mission_succeeded',
      'mission_failed','mission_cancelled','checkpoint_saved','agent_heartbeat','human_gate_requested',
      'self_improvement_human_gate','human_gate_completed','recovery_attempted','mission_verified','mission_dead_lettered',
      'cognitive_recall_completed','cognitive_planning_context_used','cognitive_loop_completed',
      'agent_executor_diagnostic','mission_chain_completed','planner_failed','learning_preflight_blocked',
      'mission_replanned','mission_hard_blocked',
      'computer_use_capabilities_confirmed','computer_use_device_confirmed',
      'computer_use_observation_started','computer_use_observation_completed',
      'computer_use_decision_made','computer_use_action_started','computer_use_action_executed',
      'computer_use_result_observed','computer_use_verification_completed',
      'computer_use_action_blocked'
    ]::text[])
  );

CREATE INDEX IF NOT EXISTS mission_events_computer_use_live_idx
  ON aria_internal.mission_events(mission_id, created_at DESC)
  WHERE event_type LIKE 'computer_use_%';

COMMENT ON CONSTRAINT mission_events_event_type_check ON aria_internal.mission_events
IS 'Canonical mission lifecycle events including Computer Use live progress evidence.';
