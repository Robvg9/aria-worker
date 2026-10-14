-- ARIA Encrypt Step 5 follow-up: do not derive learnings from unclassified mission outcomes.
-- Existing rows remain unchanged; only an explicitly general mission can produce a general learning row.

BEGIN;

CREATE OR REPLACE FUNCTION aria_internal.capture_mission_learning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  v_category text;
  v_summary text;
  v_confidence numeric;
  v_reusable boolean;
  v_checkpoint jsonb;
  v_recovery jsonb;
  v_failed_steps jsonb;
  v_next_strategy text;
  v_dynamic_failure boolean := coalesce(new.metadata->>'dynamic_goal','false')='true'
    OR lower(coalesce(new.goal,'')) LIKE 'diagnose and resolve the verified failure from mission%';
BEGIN
  IF new.status NOT IN ('succeeded','failed','cancelled') THEN
    RETURN new;
  END IF;
  IF tg_op='UPDATE' AND old.status=new.status THEN
    RETURN new;
  END IF;
  IF coalesce(new.metadata->>'structural_dedupe','false')='true' THEN
    RETURN new;
  END IF;

  -- Mission outcome details are eligible for learning only after explicit review/classification.
  IF coalesce(new.metadata->>'privacy_class','') IS DISTINCT FROM 'general' THEN
    RETURN new;
  END IF;

  v_checkpoint := coalesce(new.checkpoint,'{}'::jsonb);
  v_recovery := coalesce(v_checkpoint->'recovery','{}'::jsonb);
  v_failed_steps := coalesce(v_recovery->'failed_step_ids','[]'::jsonb);
  v_next_strategy := coalesce(v_recovery->>'next_strategy','');

  v_category := CASE
    WHEN v_dynamic_failure AND new.status='succeeded' THEN 'repair_attempt_unverified'
    WHEN new.status='succeeded' THEN 'mission_success'
    WHEN new.status='failed' THEN 'mission_failure'
    ELSE 'mission_cancelled'
  END;
  v_summary := format(
    'Mission %s ended with status=%s; completed_steps=%s/%s; recovery_count=%s; failed_step_ids=%s; next_strategy=%s',
    new.mission_id,new.status,coalesce(new.completed_steps,0),coalesce(new.total_steps,0),
    coalesce(new.recovery_count,0),left(v_failed_steps::text,500),left(v_next_strategy,500)
  );
  v_confidence := CASE
    WHEN v_dynamic_failure AND new.status='succeeded' THEN 0.50
    WHEN new.status='succeeded' THEN 0.95
    WHEN new.status='failed' THEN 0.85
    ELSE 0.70
  END;
  v_reusable := CASE
    WHEN new.status='succeeded' AND NOT v_dynamic_failure THEN true
    WHEN new.status='failed' AND (jsonb_array_length(v_failed_steps)>0 OR v_next_strategy<>'') THEN true
    ELSE false
  END;

  INSERT INTO aria_internal.autonomy_learnings(
    mission_id,goal_id,category,summary,evidence,confidence,reusable,privacy_class
  )
  VALUES (
    new.mission_id,NULL,v_category,v_summary,
    jsonb_build_object(
      'mission_status',new.status,'goal',new.goal,
      'completed_steps',coalesce(new.completed_steps,0),
      'total_steps',coalesce(new.total_steps,0),
      'recovery_count',coalesce(new.recovery_count,0),
      'attempt_count',coalesce(new.attempt_count,0),
      'failed_step_ids',v_failed_steps,'next_strategy',v_next_strategy,
      'checkpoint',v_checkpoint,'dynamic_failure_guarded',v_dynamic_failure,
      'privacy_class','general'
    ),
    v_confidence,v_reusable,'general'
  )
  ON CONFLICT (mission_id) WHERE mission_id IS NOT NULL
  DO UPDATE SET
    category=excluded.category,
    summary=excluded.summary,
    evidence=excluded.evidence,
    confidence=excluded.confidence,
    reusable=excluded.reusable,
    privacy_class=excluded.privacy_class;

  RETURN new;
END;
$function$;

COMMIT;
