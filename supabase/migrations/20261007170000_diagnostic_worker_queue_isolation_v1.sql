-- ARIA: diagnostic worker isolation from production/user missions.
-- Diagnostic/test workers must never consume a user mission from the canonical queue.
-- They may claim only rows explicitly assigned to the test lane.

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_next_lease(
  p_worker_id text,
  p_lease_for interval default '00:02:00'::interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal'
AS $function$
DECLARE
  claimed jsonb;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id)='' THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  WITH candidates AS (
    SELECT m.mission_id
      FROM aria_internal.mission_state m
     WHERE (
       m.status='queued'
       OR (m.status IN ('planning','running','paused','failed') AND m.lease_until IS NOT NULL AND m.lease_until<clock_timestamp())
       OR (m.status='running' AND m.lease_owner IS NULL
           AND NOT (coalesce(m.next_action,'')='next_ready_batch'
                    AND m.updated_at > clock_timestamp()-interval '10 minutes'))
       OR (m.status='running' AND m.lease_until IS NULL
           AND NOT (coalesce(m.next_action,'')='next_ready_batch'
                    AND m.updated_at > clock_timestamp()-interval '10 minutes'))
       OR (m.status='paused' AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       OR (m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
     )
       AND aria_internal.aria_mission_claim_eligible(m.mission_id)
       AND NOT (
         lower(p_worker_id) LIKE 'diagnostic-%'
         AND lower(coalesce(nullif(m.metadata->>'execution_lane',''), nullif(m.metadata->>'goal_source',''), '')) <> 'test'
       )
     ORDER BY
       CASE lower(coalesce(nullif(m.metadata->>'execution_lane',''), nullif(m.metadata->>'goal_source',''), ''))
         WHEN 'primary' THEN 0 WHEN 'repair' THEN 10 WHEN 'user' THEN 20
         WHEN 'meditation' THEN 30 WHEN 'idea' THEN 90 WHEN 'test' THEN 100 ELSE 50 END,
       CASE m.status WHEN 'queued' THEN 0 WHEN 'waiting' THEN 1 WHEN 'planning' THEN 2 WHEN 'paused' THEN 3 WHEN 'running' THEN 4 WHEN 'failed' THEN 5 ELSE 9 END,
       CASE WHEN m.status='queued' THEN coalesce((m.metadata->>'queue_priority')::numeric,0) ELSE 0 END DESC,
       CASE WHEN m.status='queued' THEN m.created_at ELSE m.updated_at END DESC,
       m.mission_id
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  ), updated AS (
    UPDATE aria_internal.mission_state m
       SET status=CASE WHEN m.status IN ('queued','failed') THEN 'planning' WHEN m.status='waiting' THEN 'running' ELSE 'running' END,
       lease_owner=p_worker_id,
       lease_until=clock_timestamp()+p_lease_for,
       updated_at=clock_timestamp(),
       current_workspace=coalesce(m.current_workspace,p_worker_id),
       recovery_count=CASE
         WHEN m.status='paused' THEN coalesce(m.recovery_count,0)+1
         WHEN m.status IN ('planning','running','failed') AND m.lease_until IS NOT NULL AND m.lease_until<clock_timestamp() THEN coalesce(m.recovery_count,0)+1
         ELSE coalesce(m.recovery_count,0)
       END,
       last_recovery_reason=CASE
         WHEN m.status='failed' THEN 'failed_mission_replanned'
         WHEN m.status='waiting' THEN 'verification_pending_resumed'
         WHEN m.status='paused' THEN 'paused_pending_job_reclaimed'
         WHEN m.lease_until IS NOT NULL AND m.lease_until<clock_timestamp() THEN 'lease_expired_reclaimed'
         ELSE m.last_recovery_reason
       END,
       next_action=CASE WHEN m.status='failed' THEN 'replan: prior strategy failed' WHEN m.status='waiting' THEN 'verification:resume_pending_verification' ELSE m.next_action END
      FROM candidates c
     WHERE m.mission_id=c.mission_id
     RETURNING m.*
  )
  SELECT to_jsonb(updated) INTO claimed FROM updated;
  RETURN claimed;
END;
$function$;
