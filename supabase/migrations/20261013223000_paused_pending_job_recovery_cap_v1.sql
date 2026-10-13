-- Stop repeated Meditation IA runner claims when a paused mission keeps a
-- stale pending-job checkpoint after the referenced execution job is terminal.
-- The runner may reclaim a paused pending job at most three times. Terminal
-- pending jobs already beyond that cap are blocked with a persisted diagnosis.

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_next_lease(
  p_worker_id text,
  p_lease_for interval DEFAULT '00:02:00'::interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  claimed jsonb;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  WITH candidates AS (
    SELECT m.mission_id
      FROM aria_internal.mission_state m
     WHERE (
       m.status = 'queued'
       OR (
         m.status IN ('planning','running','paused','failed')
         AND m.lease_until IS NOT NULL
         AND m.lease_until < clock_timestamp()
         AND NOT (
           m.status = 'paused'
           AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb) <> '{}'::jsonb
           AND coalesce(m.recovery_count,0) >= 3
         )
       )
       OR (
         m.status = 'running'
         AND m.lease_owner IS NULL
         AND NOT (
           coalesce(m.next_action,'') = 'next_ready_batch'
           AND m.updated_at > clock_timestamp() - interval '10 minutes'
         )
       )
       OR (
         m.status = 'running'
         AND m.lease_until IS NULL
         AND NOT (
           coalesce(m.next_action,'') = 'next_ready_batch'
           AND m.updated_at > clock_timestamp() - interval '10 minutes'
         )
       )
       OR (
         m.status = 'paused'
         AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb) <> '{}'::jsonb
         AND coalesce(m.recovery_count,0) < 3
       )
       OR (
         m.status = 'waiting'
         AND coalesce(m.checkpoint->'recovery'->>'status','') = 'verification_pending'
       )
     )
       AND aria_internal.aria_mission_claim_eligible(m.mission_id)
       AND NOT (
         lower(p_worker_id) LIKE 'diagnostic-%'
         AND lower(coalesce(nullif(m.metadata->>'execution_lane',''), nullif(m.metadata->>'goal_source',''), '')) <> 'test'
       )
       AND NOT (
         lower(coalesce(nullif(m.metadata->>'execution_lane',''), nullif(m.metadata->>'goal_source',''), ''))
           IN ('test','human_gate_e2e','diagnostic','supervisor_probe')
         AND lower(p_worker_id) NOT LIKE '%human_gate%'
         AND lower(p_worker_id) NOT LIKE '%human-gate%'
         AND lower(p_worker_id) NOT LIKE '%test%'
       )
     ORDER BY
       CASE lower(coalesce(nullif(m.metadata->>'execution_lane',''), nullif(m.metadata->>'goal_source',''), ''))
         WHEN 'primary' THEN 0
         WHEN 'repair' THEN 10
         WHEN 'user' THEN 20
         WHEN 'meditation' THEN 30
         WHEN 'idea' THEN 90
         WHEN 'test' THEN 100
         ELSE 50
       END,
       CASE m.status WHEN 'queued' THEN 0 WHEN 'waiting' THEN 1 WHEN 'planning' THEN 2 WHEN 'paused' THEN 3 WHEN 'running' THEN 4 WHEN 'failed' THEN 5 ELSE 9 END,
       CASE WHEN m.status = 'queued' THEN coalesce((m.metadata->>'queue_priority')::numeric,0) ELSE 0 END DESC,
       CASE WHEN m.status = 'queued' THEN m.created_at ELSE m.updated_at END DESC,
       m.mission_id
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  ), updated AS (
    UPDATE aria_internal.mission_state m
       SET status = CASE WHEN m.status IN ('queued','failed') THEN 'planning' WHEN m.status = 'waiting' THEN 'running' ELSE 'running' END,
           lease_owner = p_worker_id,
           lease_until = clock_timestamp() + p_lease_for,
           updated_at = clock_timestamp(),
           current_workspace = coalesce(m.current_workspace,p_worker_id),
           recovery_count = CASE
             WHEN m.status = 'paused' THEN coalesce(m.recovery_count,0) + 1
             WHEN m.status IN ('planning','running','failed')
               AND m.lease_until IS NOT NULL
               AND m.lease_until < clock_timestamp()
               THEN coalesce(m.recovery_count,0) + 1
             ELSE coalesce(m.recovery_count,0)
           END,
           last_recovery_reason = CASE
             WHEN m.status = 'failed' THEN 'failed_mission_replanned'
             WHEN m.status = 'waiting' THEN 'verification_pending_resumed'
             WHEN m.status = 'paused' THEN 'paused_pending_job_reclaimed'
             WHEN m.lease_until IS NOT NULL AND m.lease_until < clock_timestamp() THEN 'lease_expired_reclaimed'
             ELSE m.last_recovery_reason
           END,
           next_action = CASE
             WHEN m.status = 'failed' THEN 'replan: prior strategy failed'
             WHEN m.status = 'waiting' THEN 'verification:resume_pending_verification'
             ELSE m.next_action
           END
      FROM candidates c
     WHERE m.mission_id = c.mission_id
     RETURNING m.*
  )
  SELECT to_jsonb(updated) INTO claimed FROM updated;

  RETURN claimed;
END;
$function$;

-- One-time repair for already-exhausted loops whose checkpoint points only
-- to terminal execution jobs. Preserve the original pending_jobs payload as
-- evidence and keep the mission visibly blocked rather than silently paused.
WITH terminal_paused AS (
  SELECT m.mission_id
    FROM aria_internal.mission_state m
   WHERE m.status = 'paused'
     AND coalesce(m.recovery_count,0) >= 3
     AND jsonb_typeof(m.checkpoint->'pending_jobs') = 'object'
     AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb) <> '{}'::jsonb
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each(
           CASE
             WHEN jsonb_typeof(m.checkpoint->'pending_jobs') = 'object'
               THEN m.checkpoint->'pending_jobs'
             ELSE '{}'::jsonb
           END
         ) AS pending(step_id, job_ref)
         LEFT JOIN aria_internal.execution_jobs ej
           ON ej.job_id = coalesce(pending.job_ref->>'job_id', pending.job_ref->>'id')
        WHERE ej.job_id IS NULL
           OR ej.status NOT IN ('succeeded','failed','timeout','cancelled')
     )
), blocked AS (
  UPDATE aria_internal.mission_state m
     SET status = 'blocked',
         last_stderr = 'paused_pending_job_retry_cap_exceeded: checkpoint references only terminal execution jobs; automatic reclaim stopped',
         next_action = 'repair: terminal device job; do not auto-resume this mission. Replan only with the current enrolled device and fresh evidence.',
         checkpoint = jsonb_set(
           coalesce(m.checkpoint,'{}'::jsonb),
           '{recovery}',
           coalesce(m.checkpoint->'recovery','{}'::jsonb) ||
             jsonb_build_object(
               'status','retry_exhausted',
               'failure_reason','paused_pending_job_retry_cap_exceeded',
               'detected_at',clock_timestamp(),
               'observed_pending_jobs',m.checkpoint->'pending_jobs'
             ),
           true
         ),
         lease_owner = NULL,
         lease_until = NULL,
         finished_at = clock_timestamp(),
         updated_at = clock_timestamp()
    FROM terminal_paused t
   WHERE m.mission_id = t.mission_id
   RETURNING m.mission_id
)
SELECT count(*) AS paused_pending_loops_blocked FROM blocked;
