-- Behavioral integration tests for 20261101070000_aria_activation_reconciliation_guards_v1.sql.
-- Run only against the synthetic PostgreSQL fixture, never against production.
\set ON_ERROR_STOP on

-- Exercise the actual AFTER UPDATE trigger wired to the migrated trigger function.
CREATE TRIGGER fixture_mission_to_goal_verification
AFTER UPDATE OF status ON aria_internal.mission_state
FOR EACH ROW
EXECUTE FUNCTION aria_internal.sync_autonomy_goal_from_mission();

-- Canonical database admission must honor max_attempts at the final claim boundary.
INSERT INTO aria_internal.autonomy_goals
  (goal_id, goal, status, attempts, max_attempts, last_mission_id)
VALUES
  ('goal-under-cap', 'Synthetic goal under attempt cap', 'queued', 2, 3, 'mission-under-cap'),
  ('goal-at-cap', 'Synthetic exhausted goal', 'queued', 3, 3, 'mission-at-cap');

INSERT INTO aria_internal.mission_state
  (mission_id, goal, status, metadata)
VALUES
  ('mission-under-cap', 'Synthetic mission under cap', 'queued', '{"goal_id":"goal-under-cap"}'),
  ('mission-at-cap', 'Synthetic exhausted mission', 'queued', '{"goal_id":"goal-at-cap"}');

DO $$
BEGIN
  IF NOT aria_internal.aria_mission_claim_eligible('mission-under-cap') THEN
    RAISE EXCEPTION 'FAIL: goal below max_attempts was rejected';
  END IF;
  IF aria_internal.aria_mission_claim_eligible('mission-at-cap') THEN
    RAISE EXCEPTION 'FAIL: exhausted goal remained claimable';
  END IF;
END;
$$;

-- Nonterminal mission state is observed separately without falsely completing the goal.
INSERT INTO aria_internal.autonomy_goals
  (goal_id, goal, status, last_mission_id)
VALUES
  ('goal-observation', 'Synthetic observation goal', 'running', 'mission-observation');

INSERT INTO aria_internal.mission_state
  (mission_id, goal, status, metadata, next_action, checkpoint)
VALUES
  ('mission-observation', 'Synthetic observation mission', 'queued',
   '{"goal_id":"goal-observation"}', 'initial', '{"recovery":{"status":"none"}}');

UPDATE aria_internal.mission_state
   SET status='paused',
       next_action='waiting_for_operator',
       checkpoint='{"recovery":{"status":"waiting_for_human_gate"}}'::jsonb
 WHERE mission_id='mission-observation';

DO $$
DECLARE
  g aria_internal.autonomy_goals;
BEGIN
  SELECT * INTO g
    FROM aria_internal.autonomy_goals
   WHERE goal_id='goal-observation';
  IF g.latest_mission_status <> 'paused'
     OR g.latest_mission_next_action <> 'waiting_for_operator'
     OR g.latest_mission_recovery_status <> 'waiting_for_human_gate'
     OR g.latest_mission_observed_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: nonterminal mission observation columns were not populated: %', row_to_json(g);
  END IF;
  IF g.status <> 'running' THEN
    RAISE EXCEPTION 'FAIL: a paused mission observation unexpectedly changed goal lifecycle status to %', g.status;
  END IF;
END;
$$;

-- A successful mission still passes semantic verification before goal completion.
UPDATE aria_internal.mission_state
   SET status='succeeded'
 WHERE mission_id='mission-observation';

DO $$
DECLARE
  g aria_internal.autonomy_goals;
BEGIN
  SELECT * INTO g
    FROM aria_internal.autonomy_goals
   WHERE goal_id='goal-observation';
  IF g.latest_mission_status <> 'succeeded'
     OR g.status <> 'completed'
     OR g.objective_verification_status <> 'CONFIRMED'
     OR g.objective_verified_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: successful mission did not complete through semantic verification: %', row_to_json(g);
  END IF;
END;
$$;

-- Queue reconciliation must resolve a goal through its pinned mission and terminalize both item types.
INSERT INTO aria_internal.autonomy_goals
  (goal_id, goal, status, last_mission_id)
VALUES
  ('goal-terminal-queue', 'Synthetic terminal queue goal', 'running', 'mission-terminal-queue');

INSERT INTO aria_internal.mission_state
  (mission_id, goal, status, metadata)
VALUES
  ('mission-terminal-queue', 'Synthetic terminal queue mission', 'succeeded',
   '{"goal_id":"goal-terminal-queue"}');

INSERT INTO aria_internal.meditation_queue
  (queue_id, item_type, item_id, resolved_mission_id, status)
VALUES
  ('queue-mission-terminal', 'mission', 'mission-terminal-queue', NULL, 'queued'),
  ('queue-goal-terminal', 'goal', 'goal-terminal-queue', 'mission-terminal-queue', 'running');

-- Missing mission references are failed explicitly for both supported item types.
INSERT INTO aria_internal.autonomy_goals
  (goal_id, goal, status, last_mission_id)
VALUES
  ('goal-missing-queue', 'Synthetic missing mission queue goal', 'queued', 'mission-does-not-exist');

INSERT INTO aria_internal.meditation_queue
  (queue_id, item_type, item_id, resolved_mission_id, status)
VALUES
  ('queue-mission-missing', 'mission', 'mission-does-not-exist-direct', NULL, 'queued'),
  ('queue-goal-missing', 'goal', 'goal-missing-queue', NULL, 'queued');

-- A paused queue item resumes only for an explicit next_ready_batch continuation without a lease.
INSERT INTO aria_internal.autonomy_goals
  (goal_id, goal, status, last_mission_id)
VALUES
  ('goal-resume-queue', 'Synthetic continuation goal', 'paused', 'mission-resume-queue');

INSERT INTO aria_internal.mission_state
  (mission_id, goal, status, metadata, next_action, lease_until)
VALUES
  ('mission-resume-queue', 'Synthetic continuation mission', 'running',
   '{"goal_id":"goal-resume-queue"}', 'next_ready_batch', NULL);

INSERT INTO aria_internal.meditation_queue
  (queue_id, item_type, item_id, resolved_mission_id, status)
VALUES
  ('queue-mission-resume', 'mission', 'mission-resume-queue', NULL, 'paused'),
  ('queue-goal-resume', 'goal', 'goal-resume-queue', 'mission-resume-queue', 'paused');

-- Queued/running children of a paused parent are demoted to paused.
INSERT INTO aria_internal.autonomy_goals
  (goal_id, goal, status, last_mission_id)
VALUES
  ('goal-paused-queue', 'Synthetic paused-parent goal', 'paused', 'mission-paused-queue');

INSERT INTO aria_internal.mission_state
  (mission_id, goal, status, metadata, next_action)
VALUES
  ('mission-paused-queue', 'Synthetic paused-parent mission', 'paused',
   '{"goal_id":"goal-paused-queue"}', 'waiting_for_human_gate');

INSERT INTO aria_internal.meditation_queue
  (queue_id, item_type, item_id, resolved_mission_id, status)
VALUES
  ('queue-mission-demote', 'mission', 'mission-paused-queue', NULL, 'queued'),
  ('queue-goal-demote', 'goal', 'goal-paused-queue', 'mission-paused-queue', 'running');

SELECT aria_internal.reconcile_meditation_queue_v2();

DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
    FROM aria_internal.meditation_queue
   WHERE queue_id IN ('queue-mission-terminal','queue-goal-terminal')
     AND status <> 'completed';
  IF bad_count <> 0 THEN RAISE EXCEPTION 'FAIL: terminal queue records were not completed'; END IF;

  SELECT count(*) INTO bad_count
    FROM aria_internal.meditation_queue
   WHERE queue_id IN ('queue-mission-missing','queue-goal-missing')
     AND (status <> 'failed' OR last_error <> 'mission_not_found');
  IF bad_count <> 0 THEN RAISE EXCEPTION 'FAIL: missing mission references were not failed'; END IF;

  SELECT count(*) INTO bad_count
    FROM aria_internal.meditation_queue
   WHERE queue_id IN ('queue-mission-resume','queue-goal-resume')
     AND status <> 'running';
  IF bad_count <> 0 THEN RAISE EXCEPTION 'FAIL: explicit next_ready_batch continuation was not resumed'; END IF;

  SELECT count(*) INTO bad_count
    FROM aria_internal.meditation_queue
   WHERE queue_id IN ('queue-mission-demote','queue-goal-demote')
     AND status <> 'paused';
  IF bad_count <> 0 THEN RAISE EXCEPTION 'FAIL: queued/running child of a paused mission was not demoted'; END IF;
END;
$$;


-- Standalone missions without an autonomy goal must carry an explicit execution lane.
-- A source label by itself is not sufficient to make an old queued task auto-runnable.
INSERT INTO aria_internal.mission_state (mission_id, goal, status, metadata)
VALUES
  ('mission-no-goal-unclassified', 'Synthetic no-goal mission with no lane', 'queued', '{}'::jsonb),
  ('mission-no-goal-source-only', 'Synthetic no-goal mission with source but no lane', 'queued',
    '{"source":"battlecruiser_step4_rwht_windows_readonly_batch_v1"}'::jsonb),
  ('mission-no-goal-user-lane', 'Synthetic no-goal mission with explicit user lane', 'queued',
    '{"execution_lane":"user"}'::jsonb),
  ('mission-no-goal-test-lane', 'Synthetic no-goal test mission with explicit lane', 'queued',
    '{"execution_lane":"test"}'::jsonb),
  ('mission-no-goal-human-gate-lane', 'Synthetic no-goal Human Gate mission with explicit lane', 'queued',
    '{"goal_source":"human_gate_e2e"}'::jsonb);

DO $
BEGIN
  IF aria_internal.aria_mission_claim_eligible('mission-no-goal-unclassified') THEN
    RAISE EXCEPTION 'FAIL: no-goal mission without an explicit lane remained claimable';
  END IF;
  IF aria_internal.aria_mission_claim_eligible('mission-no-goal-source-only') THEN
    RAISE EXCEPTION 'FAIL: source label alone incorrectly authorized a no-goal mission';
  END IF;
  IF NOT aria_internal.aria_mission_claim_eligible('mission-no-goal-user-lane') THEN
    RAISE EXCEPTION 'FAIL: explicit user lane was rejected for a no-goal mission';
  END IF;
  IF NOT aria_internal.aria_mission_claim_eligible('mission-no-goal-test-lane') THEN
    RAISE EXCEPTION 'FAIL: explicit test lane should remain eligible for its separately gated test worker';
  END IF;
  IF NOT aria_internal.aria_mission_claim_eligible('mission-no-goal-human-gate-lane') THEN
    RAISE EXCEPTION 'FAIL: explicit Human Gate lane should remain available to its separately gated workflow';
  END IF;
END;
$;

SELECT 'ARIA_ACTIVATION_RECONCILIATION_POSTGRES_INTEGRATION_PASS' AS result;
