-- ARIA activation/reconciliation guards v1.
-- Function/schema definitions only. No production rows are backfilled or changed
-- by this migration. Queue and mission reconciliation runs only when the existing
-- protected runner path is explicitly invoked after the separate activation gate.

ALTER TABLE aria_internal.autonomy_goals
  ADD COLUMN IF NOT EXISTS latest_mission_status text,
  ADD COLUMN IF NOT EXISTS latest_mission_next_action text,
  ADD COLUMN IF NOT EXISTS latest_mission_recovery_status text,
  ADD COLUMN IF NOT EXISTS latest_mission_observed_at timestamptz;

COMMENT ON COLUMN aria_internal.autonomy_goals.latest_mission_status IS
  'Last observed canonical mission_state.status for last_mission_id; does not replace autonomy_goals.status.';
COMMENT ON COLUMN aria_internal.autonomy_goals.latest_mission_next_action IS
  'Last observed mission_state.next_action for last_mission_id; operational context only.';
COMMENT ON COLUMN aria_internal.autonomy_goals.latest_mission_recovery_status IS
  'Last observed checkpoint.recovery.status for last_mission_id; operational context only.';
COMMENT ON COLUMN aria_internal.autonomy_goals.latest_mission_observed_at IS
  'Timestamp when the latest mission state was copied to the autonomy goal observation columns.';

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_eligible(p_mission_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
select exists (
  select 1
    from aria_internal.mission_state m
    left join aria_internal.autonomy_goals g
      on g.goal_id=coalesce(m.metadata->>'goal_id','')
    left join aria_internal.vision_objectives v
      on v.objective_id=coalesce(g.metadata->>'vision_objective_id','')
   where m.mission_id=p_mission_id
     and m.status in ('queued','failed','paused','planning','running','waiting')
     and coalesce(m.checkpoint->'recovery'->>'status','') not in (
       'waiting_for_human_gate','human_gate_pending','retry_exhausted'
     )
     and (
       m.status <> 'waiting'
       or coalesce(m.checkpoint->'recovery'->>'status','') in ('verification_pending','waiting_for_alternative_strategy')
     )
     and not (
       m.status='failed'
       and coalesce(m.last_recovery_reason,'')='failed_mission_replanned'
       and coalesce(m.recovery_count,0)>=3
       and coalesce(m.checkpoint->'recovery'->>'failure_reason','')='coordinator_test_evidence_missing'
     )
     and (
       g.goal_id is null
       or (
         -- A human-governed explicit max_attempts increase is required to reopen
         -- an exhausted goal. Ordinary queue/supervisor retries cannot bypass it.
         coalesce(g.attempts,0) < coalesce(g.max_attempts,3)
         and coalesce(g.objective_verification_status,'UNVERIFIED')<>'DUPLICATE_HISTORICAL'
         and coalesce(g.status,'')<>'completed'
         and (g.last_mission_id is null or g.last_mission_id=m.mission_id)
         and (
           coalesce(g.status,'')<>'blocked'
           or (
             g.last_mission_id=m.mission_id
             and (
               coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
               or coalesce(m.metadata->>'replan_required','')='true'
               or coalesce(m.metadata->>'resume_blocked_goal','')='true'
             )
           )
         )
         and (
           v.objective_id is null
           or v.status<>'completed'
           or coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
           or coalesce(m.metadata->>'replan_required','')='true'
           or coalesce(m.metadata->>'resume_blocked_goal','')='true'
         )
         and (
           jsonb_array_length(coalesce(g.metadata->'dependencies','[]'::jsonb))=0
           or not exists (
             select 1
               from jsonb_array_elements_text(coalesce(g.metadata->'dependencies','[]'::jsonb)) d(dep_id)
               left join aria_internal.autonomy_goals dep
                 on dep.goal_id=aria_internal.resolve_dependency_goal_id(d.dep_id)
              where dep.goal_id is null
                 or dep.status<>'completed'
                 or dep.objective_verification_status<>'CONFIRMED'
           )
         )
       )
     )
);
$function$;

CREATE OR REPLACE FUNCTION aria_internal.reconcile_meditation_queue_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','aria_internal'
AS $function$
DECLARE
  n_completed integer := 0;
  n_missing integer := 0;
  n_resumed integer := 0;
  n_demoted integer := 0;
  v_rows integer := 0;
BEGIN
  -- Mission rows resolve by item_id. Goal rows resolve by their pinned
  -- resolved_mission_id, falling back to autonomy_goals.last_mission_id.
  UPDATE aria_internal.meditation_queue q
     SET status='failed',
         last_error='mission_not_found',
         completed_at=clock_timestamp(),
         updated_at=clock_timestamp()
   WHERE q.status IN ('queued','running','paused')
     AND q.item_type='mission'
     AND NOT EXISTS (
       SELECT 1
         FROM aria_internal.mission_state m
        WHERE m.mission_id=q.item_id
     );
  GET DIAGNOSTICS n_missing = ROW_COUNT;

  UPDATE aria_internal.meditation_queue q
     SET status='failed',
         last_error='mission_not_found',
         completed_at=clock_timestamp(),
         updated_at=clock_timestamp()
    FROM aria_internal.autonomy_goals g
   WHERE q.item_type='goal'
     AND q.item_id=g.goal_id
     AND q.status IN ('queued','running','paused')
     AND coalesce(nullif(q.resolved_mission_id,''),nullif(g.last_mission_id,'')) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM aria_internal.mission_state m
        WHERE m.mission_id=coalesce(nullif(q.resolved_mission_id,''),nullif(g.last_mission_id,''))
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  n_missing := n_missing + v_rows;

  -- Terminal mission state is authoritative for both queue item types.
  UPDATE aria_internal.meditation_queue q
     SET status=CASE m.status
                  WHEN 'succeeded' THEN 'completed'
                  WHEN 'failed' THEN 'failed'
                  WHEN 'blocked' THEN 'blocked'
                  WHEN 'cancelled' THEN 'cancelled'
                  ELSE q.status
                END,
         last_error=CASE
                      WHEN m.status IN ('failed','blocked') THEN coalesce(m.last_stderr,m.next_action)
                      WHEN m.status='succeeded' THEN NULL
                      WHEN m.status='cancelled' THEN coalesce(q.last_error,'mission_cancelled')
                      ELSE q.last_error
                    END,
         completed_at=coalesce(q.completed_at,clock_timestamp()),
         updated_at=clock_timestamp()
    FROM aria_internal.mission_state m
   WHERE q.item_type='mission'
     AND q.item_id=m.mission_id
     AND q.status IN ('queued','running','paused')
     AND m.status IN ('succeeded','failed','blocked','cancelled');
  GET DIAGNOSTICS n_completed = ROW_COUNT;

  UPDATE aria_internal.meditation_queue q
     SET status=CASE m.status
                  WHEN 'succeeded' THEN 'completed'
                  WHEN 'failed' THEN 'failed'
                  WHEN 'blocked' THEN 'blocked'
                  WHEN 'cancelled' THEN 'cancelled'
                  ELSE q.status
                END,
         last_error=CASE
                      WHEN m.status IN ('failed','blocked') THEN coalesce(m.last_stderr,m.next_action)
                      WHEN m.status='succeeded' THEN NULL
                      WHEN m.status='cancelled' THEN coalesce(q.last_error,'mission_cancelled')
                      ELSE q.last_error
                    END,
         completed_at=coalesce(q.completed_at,clock_timestamp()),
         updated_at=clock_timestamp()
    FROM aria_internal.autonomy_goals g, aria_internal.mission_state m
   WHERE q.item_type='goal'
     AND q.item_id=g.goal_id
     AND m.mission_id=coalesce(nullif(q.resolved_mission_id,''),nullif(g.last_mission_id,''))
     AND q.status IN ('queued','running','paused')
     AND m.status IN ('succeeded','failed','blocked','cancelled');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  n_completed := n_completed + v_rows;

  SELECT count(*) INTO n_resumed
    FROM aria_internal.meditation_queue q
    LEFT JOIN aria_internal.autonomy_goals g
      ON q.item_type='goal' AND g.goal_id=q.item_id
    JOIN aria_internal.mission_state m
      ON m.mission_id=CASE
        WHEN q.item_type='mission' THEN q.item_id
        ELSE coalesce(nullif(q.resolved_mission_id,''),nullif(g.last_mission_id,''))
      END
   WHERE q.item_type IN ('mission','goal')
     AND q.status='paused'
     AND m.status='running'
     AND m.lease_until IS NULL
     AND coalesce(m.next_action,'')='next_ready_batch';

  UPDATE aria_internal.meditation_queue q
     SET status='running',
         last_error=NULL,
         completed_at=NULL,
         updated_at=clock_timestamp()
    FROM aria_internal.autonomy_goals g, aria_internal.mission_state m
   WHERE q.item_type='goal'
     AND q.item_id=g.goal_id
     AND m.mission_id=coalesce(nullif(q.resolved_mission_id,''),nullif(g.last_mission_id,''))
     AND q.status='paused'
     AND m.status='running'
     AND m.lease_until IS NULL
     AND coalesce(m.next_action,'')='next_ready_batch';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  n_resumed := greatest(n_resumed,v_rows);

  UPDATE aria_internal.meditation_queue q
     SET status='running',
         last_error=NULL,
         completed_at=NULL,
         updated_at=clock_timestamp()
    FROM aria_internal.mission_state m
   WHERE q.item_type='mission'
     AND q.item_id=m.mission_id
     AND q.status='paused'
     AND m.status='running'
     AND m.lease_until IS NULL
     AND coalesce(m.next_action,'')='next_ready_batch';

  -- A paused parent must not leave a queued child that still looks runnable.
  UPDATE aria_internal.meditation_queue q
     SET status='paused',
         updated_at=clock_timestamp()
    FROM aria_internal.autonomy_goals g, aria_internal.mission_state m
   WHERE q.item_type='goal'
     AND q.item_id=g.goal_id
     AND m.mission_id=coalesce(nullif(q.resolved_mission_id,''),nullif(g.last_mission_id,''))
     AND q.status IN ('queued','running')
     AND m.status='paused'
     AND coalesce(m.next_action,'')<>'next_ready_batch';
  GET DIAGNOSTICS n_demoted = ROW_COUNT;

  UPDATE aria_internal.meditation_queue q
     SET status='paused',
         updated_at=clock_timestamp()
    FROM aria_internal.mission_state m
   WHERE q.item_type='mission'
     AND q.item_id=m.mission_id
     AND q.status IN ('queued','running')
     AND m.status='paused'
     AND coalesce(m.next_action,'')<>'next_ready_batch';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  n_demoted := n_demoted + v_rows;

  RETURN jsonb_build_object(
    'version','v3',
    'checked_at',clock_timestamp(),
    'queue_terminalized',n_completed,
    'queue_missing_mission',n_missing,
    'queue_continuations_resumed',n_resumed,
    'queue_running_demoted_to_paused',n_demoted,
    'queue_failed',n_missing
  );
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.reconcile_meditation_queue_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.reconcile_meditation_queue_v2() TO service_role;

CREATE OR REPLACE FUNCTION aria_internal.sync_autonomy_goal_from_mission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  gid text := coalesce(NEW.metadata->>'goal_id','');
  v jsonb;
  verified_status text;
  ag aria_internal.autonomy_goals;
  retryable boolean;
BEGIN
  IF gid='' THEN RETURN NEW; END IF;

  SELECT * INTO ag
    FROM aria_internal.autonomy_goals
   WHERE goal_id=gid;
  IF NOT FOUND OR ag.objective_verification_status='DUPLICATE_HISTORICAL' THEN
    RETURN NEW;
  END IF;
  IF ag.last_mission_id IS DISTINCT FROM NEW.mission_id THEN
    RETURN NEW;
  END IF;

  UPDATE aria_internal.autonomy_goals
     SET latest_mission_status=NEW.status,
         latest_mission_next_action=NEW.next_action,
         latest_mission_recovery_status=nullif(NEW.checkpoint->'recovery'->>'status',''),
         latest_mission_observed_at=clock_timestamp()
   WHERE goal_id=gid;

  IF NEW.status NOT IN ('succeeded','failed','blocked','timeout','cancelled') THEN
    RETURN NEW;
  END IF;

  IF NEW.status='cancelled' THEN RETURN NEW; END IF;
  IF ag.status='completed' AND ag.objective_verification_status='CONFIRMED' THEN
    RETURN NEW;
  END IF;

  IF NEW.status='succeeded' THEN
    v:=aria_internal.verify_objective_fulfilled_v9(gid);
    verified_status:=coalesce(v->>'status','UNVERIFIED');
    UPDATE aria_internal.autonomy_goals
       SET objective_verification_status=verified_status,
           objective_verification_reason=coalesce(v->>'reason','Mission succeeded; objective verification pending.'),
           objective_verification_evidence=coalesce(ag.objective_verification_evidence,'{}'::jsonb)
             || jsonb_build_object(
               'mission_id',NEW.mission_id,
               'mission_status','succeeded',
               'verification_result',v,
               'verified_at',clock_timestamp()
             ),
           objective_verified_at=CASE WHEN verified_status='CONFIRMED' THEN clock_timestamp() ELSE NULL END,
           status=CASE
             WHEN verified_status='CONFIRMED' THEN 'completed'
             WHEN verified_status IN ('BLOCKED_LEGITIMATE','FAILED_OBJECTIVE_VERIFICATION','DISPROVED') THEN 'blocked'
             ELSE 'queued'
           END,
           next_run_at=clock_timestamp(),
           updated_at=clock_timestamp()
     WHERE goal_id=gid;
  ELSIF NEW.status='blocked' THEN
    UPDATE aria_internal.autonomy_goals
       SET status='blocked',
           objective_verification_status=CASE
             WHEN objective_verification_status='CONFIRMED' THEN 'CONFIRMED'
             ELSE coalesce(objective_verification_status,'UNVERIFIED')
           END,
           objective_verification_reason=coalesce(
             objective_verification_reason,
             'Latest mission is blocked; objective completion not inferred.'
           ),
           next_run_at=clock_timestamp(),
           updated_at=clock_timestamp()
     WHERE goal_id=gid
       AND status IN ('queued','running','paused','blocked');
  ELSE
    SELECT (attempts<max_attempts) INTO retryable
      FROM aria_internal.autonomy_goals
     WHERE goal_id=gid;

    UPDATE aria_internal.autonomy_goals
       SET status=CASE WHEN coalesce(retryable,false) THEN 'queued' ELSE 'blocked' END,
           objective_verification_status=CASE
             WHEN coalesce(retryable,false) THEN 'UNVERIFIED'
             ELSE 'FAILED_OBJECTIVE_VERIFICATION'
           END,
           objective_verification_reason='Latest mission ended without objective confirmation: '||NEW.status,
           next_run_at=clock_timestamp(),
           updated_at=clock_timestamp()
     WHERE goal_id=gid
       AND status IN ('queued','running','paused','blocked')
       AND objective_verification_status<>'CONFIRMED';
  END IF;

  RETURN NEW;
END;
$function$;
