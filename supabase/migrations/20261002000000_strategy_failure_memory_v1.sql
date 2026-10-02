-- Global strategy failure memory: persist repeated route failures across missions
-- and prevent ARIA from re-executing a known-bad goal-scoped strategy.
CREATE TABLE IF NOT EXISTS aria_internal.strategy_failure_ledger (
  goal_signature text NOT NULL,
  strategy_fingerprint text NOT NULL,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  blocked boolean NOT NULL DEFAULT false,
  hard_block boolean NOT NULL DEFAULT false,
  first_failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_failure_code text,
  last_failure_message text,
  last_mission_id text,
  last_step_id text,
  plan_fingerprint text,
  strategy_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  recent_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (goal_signature, strategy_fingerprint)
);

ALTER TABLE aria_internal.strategy_failure_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aria_internal.strategy_failure_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON aria_internal.strategy_failure_ledger TO service_role;

CREATE INDEX IF NOT EXISTS strategy_failure_ledger_goal_blocked_idx
  ON aria_internal.strategy_failure_ledger(goal_signature, blocked, last_failed_at DESC);

CREATE OR REPLACE FUNCTION aria_internal.record_strategy_failure(
  p_goal_signature text,
  p_strategy_fingerprint text,
  p_strategy_summary jsonb,
  p_failure_code text,
  p_failure_message text,
  p_mission_id text,
  p_step_id text,
  p_plan_fingerprint text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE
  v_replan_threshold integer := 3;
  v_hard_threshold integer := 5;
  v_count integer;
  v_blocked boolean;
  v_hard_block boolean;
  v_recent jsonb;
  v_detail jsonb;
BEGIN
  SELECT
    greatest(1, least(5, coalesce(same_strategy_replan_threshold, 3))),
    greatest(2, least(10, coalesce(same_strategy_hard_block_threshold, 5)))
  INTO v_replan_threshold, v_hard_threshold
  FROM aria_internal.runtime_job_policy
  WHERE policy_id = 1;

  IF p_goal_signature IS NULL OR btrim(p_goal_signature) = ''
     OR p_strategy_fingerprint IS NULL OR btrim(p_strategy_fingerprint) = '' THEN
    RAISE EXCEPTION 'strategy_failure_memory_key_missing';
  END IF;

  v_detail := jsonb_build_object(
    'mission_id', p_mission_id,
    'step_id', p_step_id,
    'failure_code', p_failure_code,
    'failure_message', left(coalesce(p_failure_message, ''), 2000),
    'plan_fingerprint', p_plan_fingerprint,
    'at', clock_timestamp(),
    'evidence', coalesce(p_evidence, '{}'::jsonb)
  );

  INSERT INTO aria_internal.strategy_failure_ledger (
    goal_signature, strategy_fingerprint, failure_count, blocked, hard_block,
    last_failure_code, last_failure_message, last_mission_id, last_step_id,
    plan_fingerprint, strategy_summary, recent_evidence
  )
  VALUES (
    p_goal_signature, p_strategy_fingerprint, 1,
    1 >= v_replan_threshold, 1 >= v_hard_threshold,
    left(coalesce(p_failure_code, 'strategy_failed'), 300),
    left(coalesce(p_failure_message, ''), 2000),
    p_mission_id, p_step_id, p_plan_fingerprint,
    coalesce(p_strategy_summary, '{}'::jsonb),
    jsonb_build_array(v_detail)
  )
  ON CONFLICT (goal_signature, strategy_fingerprint) DO UPDATE
  SET
    failure_count = aria_internal.strategy_failure_ledger.failure_count + 1,
    blocked = (aria_internal.strategy_failure_ledger.failure_count + 1) >= v_replan_threshold,
    hard_block = (aria_internal.strategy_failure_ledger.failure_count + 1) >= v_hard_threshold,
    last_failed_at = clock_timestamp(),
    last_failure_code = left(coalesce(EXCLUDED.last_failure_code, 'strategy_failed'), 300),
    last_failure_message = left(coalesce(EXCLUDED.last_failure_message, ''), 2000),
    last_mission_id = EXCLUDED.last_mission_id,
    last_step_id = EXCLUDED.last_step_id,
    plan_fingerprint = EXCLUDED.plan_fingerprint,
    strategy_summary = EXCLUDED.strategy_summary,
    recent_evidence = (
      jsonb_build_array(v_detail) || coalesce(aria_internal.strategy_failure_ledger.recent_evidence, '[]'::jsonb)
    ),
    updated_at = clock_timestamp()
  RETURNING failure_count, blocked, hard_block, recent_evidence
  INTO v_count, v_blocked, v_hard_block, v_recent;

  IF jsonb_typeof(v_recent) <> 'array' THEN
    v_recent := jsonb_build_array(v_detail);
  ELSIF jsonb_array_length(v_recent) > 6 THEN
    SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb)
      INTO v_recent
      FROM (
        SELECT value, ordinality AS ord
        FROM jsonb_array_elements(v_recent) WITH ORDINALITY
        LIMIT 6
      ) capped;
    UPDATE aria_internal.strategy_failure_ledger
       SET recent_evidence = v_recent, updated_at = clock_timestamp()
     WHERE goal_signature = p_goal_signature
       AND strategy_fingerprint = p_strategy_fingerprint;
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'goal_signature', p_goal_signature,
    'strategy_fingerprint', p_strategy_fingerprint,
    'failure_count', v_count,
    'blocked', v_blocked,
    'hard_block', v_hard_block,
    'same_strategy_replan_threshold', v_replan_threshold,
    'same_strategy_hard_block_threshold', v_hard_threshold,
    'last_failure_code', p_failure_code,
    'last_failure_message', left(coalesce(p_failure_message, ''), 2000),
    'last_mission_id', p_mission_id,
    'last_step_id', p_step_id,
    'plan_fingerprint', p_plan_fingerprint,
    'strategy_summary', coalesce(p_strategy_summary, '{}'::jsonb),
    'recent_evidence', v_recent
  );
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.record_strategy_failure(
  text,text,jsonb,text,text,text,text,text,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.record_strategy_failure(
  text,text,jsonb,text,text,text,text,text,jsonb
) TO service_role;

COMMENT ON TABLE aria_internal.strategy_failure_ledger IS
  'Goal-scoped persistent failure memory. Three repeated failures block a route; five create a hard block.';

COMMENT ON FUNCTION aria_internal.record_strategy_failure(
  text,text,jsonb,text,text,text,text,text,jsonb
) IS
  'Persist one failed execution route and raise governed exclusion thresholds using runtime_job_policy.';
