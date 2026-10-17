-- Resume an asynchronous mission only after the exact checkpoint-bound device job
-- has reached a terminal result. Arbitrary "waiting" missions remain ineligible.
CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_eligible(p_mission_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
SELECT EXISTS (
  SELECT 1
    FROM aria_internal.mission_state m
    LEFT JOIN aria_internal.autonomy_goals g
      ON g.goal_id=coalesce(m.metadata->>'goal_id','')
    LEFT JOIN aria_internal.vision_objectives v
      ON v.objective_id=coalesce(g.metadata->>'vision_objective_id','')
   WHERE m.mission_id=p_mission_id
     AND m.status IN ('queued','failed','paused','planning','running','waiting')
     AND coalesce(m.checkpoint->'recovery'->>'status','') NOT IN
       ('waiting_for_human_gate','human_gate_pending','retry_exhausted')
     AND (
       m.status <> 'waiting'
       OR coalesce(m.checkpoint->'recovery'->>'status','') IN ('verification_pending','waiting_for_alternative_strategy')
       OR (
         coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_async_executor'
         AND EXISTS (
           SELECT 1
             FROM jsonb_each(coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)) pending(step_id,pending_job)
             JOIN aria_internal.execution_jobs j
               ON j.job_id=pending.pending_job->>'job_id'
              AND j.mission_id=m.mission_id
            WHERE j.status IN ('succeeded','failed','timeout')
              AND j.completed_at IS NOT NULL
         )
       )
     )
     AND NOT (
       m.status='failed'
       AND coalesce(m.last_recovery_reason,'')='failed_mission_replanned'
       AND coalesce(m.recovery_count,0)>=3
       AND coalesce(m.checkpoint->'recovery'->>'failure_reason','')='coordinator_test_evidence_missing'
     )
     AND (
       g.goal_id IS NULL
       OR (
         coalesce(g.objective_verification_status,'UNVERIFIED')<>'DUPLICATE_HISTORICAL'
         AND coalesce(g.status,'')<>'completed'
         AND (g.last_mission_id IS NULL OR g.last_mission_id=m.mission_id)
         AND (
           coalesce(g.status,'')<>'blocked'
           OR (
             g.last_mission_id=m.mission_id
             AND (
               coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
               OR coalesce(m.metadata->>'replan_required','')='true'
               OR coalesce(m.metadata->>'resume_blocked_goal','')='true'
             )
           )
         )
         AND (
           v.objective_id IS NULL
           OR v.status<>'completed'
           OR coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
           OR coalesce(m.metadata->>'replan_required','')='true'
           OR coalesce(m.metadata->>'resume_blocked_goal','')='true'
         )
         AND (
           jsonb_array_length(coalesce(g.metadata->'dependencies','[]'::jsonb))=0
           OR NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(coalesce(g.metadata->'dependencies','[]'::jsonb)) d(dep_id)
               LEFT JOIN aria_internal.autonomy_goals dep
                 ON dep.goal_id=aria_internal.resolve_dependency_goal_id(d.dep_id)
              WHERE dep.goal_id IS NULL
                 OR dep.status<>'completed'
                 OR dep.objective_verification_status<>'CONFIRMED'
           )
         )
       )
     )
);
$function$;

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_by_id_lease(
  p_mission_id text,
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
  IF p_mission_id IS NULL OR btrim(p_mission_id)='' THEN
    RAISE EXCEPTION 'mission_id_required';
  END IF;
  IF p_worker_id IS NULL OR btrim(p_worker_id)='' THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  WITH candidate AS (
    SELECT m.mission_id
      FROM aria_internal.mission_state m
     WHERE m.mission_id=p_mission_id
       AND (
         m.status='queued'
         OR (m.status IN ('paused','failed') AND (m.lease_until IS NULL OR m.lease_until<clock_timestamp()))
         OR (m.status IN ('planning','running') AND m.lease_until IS NOT NULL AND m.lease_until<clock_timestamp())
         OR (m.status IN ('planning','running','paused') AND m.lease_owner=p_worker_id AND m.lease_until IS NOT NULL AND m.lease_until>clock_timestamp())
         OR (m.status='running' AND m.lease_owner IS NULL)
         OR (m.status='running' AND m.lease_until IS NULL)
         OR (m.status='waiting'
             AND coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending'
             AND (m.lease_owner IS NULL OR m.lease_until IS NULL OR m.lease_until<clock_timestamp()))
         OR (m.status='waiting'
             AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy'
             AND (m.lease_owner IS NULL OR m.lease_until IS NULL OR m.lease_until<clock_timestamp()))
         OR (m.status='waiting'
             AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_async_executor'
             AND (m.lease_owner IS NULL OR m.lease_until IS NULL OR m.lease_until<clock_timestamp())
             AND EXISTS (
               SELECT 1
                 FROM jsonb_each(coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)) pending(step_id,pending_job)
                 JOIN aria_internal.execution_jobs j
                   ON j.job_id=pending.pending_job->>'job_id'
                  AND j.mission_id=m.mission_id
                WHERE j.status IN ('succeeded','failed','timeout')
                  AND j.completed_at IS NOT NULL
             ))
       )
       AND aria_internal.aria_mission_claim_eligible(m.mission_id)
       AND NOT (coalesce(m.checkpoint->'recovery'->>'status','') IN ('waiting_for_human_gate','human_gate_pending','retry_exhausted'))
     FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE aria_internal.mission_state m
       SET status='running',
           lease_owner=p_worker_id,
           lease_until=clock_timestamp()+p_lease_for,
           updated_at=clock_timestamp(),
           current_workspace=coalesce(m.current_workspace,p_worker_id),
           recovery_count=CASE
             WHEN m.lease_until IS NOT NULL AND m.lease_until<clock_timestamp()
               THEN coalesce(m.recovery_count,0)+1
             ELSE coalesce(m.recovery_count,0)
           END,
           last_recovery_reason=CASE
             WHEN m.status='failed' THEN 'failed_mission_replanned'
             WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending' THEN 'verification_pending_resumed'
             WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy' THEN 'alternative_strategy_recovery_resumed'
             WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_async_executor' THEN 'async_executor_completed_resumed'
             WHEN m.lease_until IS NOT NULL AND m.lease_until<clock_timestamp() THEN 'lease_expired_reclaimed'
             WHEN m.status='paused' THEN 'explicit_resume_reclaimed'
             ELSE m.last_recovery_reason
           END,
           next_action=CASE
             WHEN m.status='failed' THEN 'replan: prior strategy failed'
             WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending' THEN 'verification:resume_pending_verification'
             WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy' THEN 'next_ready_batch'
             WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_async_executor' THEN 'resume:completed_async_device_job'
             ELSE m.next_action
           END,
           checkpoint=aria_internal.aria_materialize_human_gate_approval(
             CASE
               WHEN m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','')='waiting_for_alternative_strategy'
                 THEN jsonb_set(coalesce(m.checkpoint,'{}'::jsonb),'{recovery,replan_required}','true'::jsonb,true)
               ELSE m.checkpoint
             END
           )
      FROM candidate c
     WHERE m.mission_id=c.mission_id
     RETURNING m.*
  )
  SELECT to_jsonb(updated) INTO claimed FROM updated;
  RETURN claimed;
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.aria_mission_claim_eligible(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.aria_mission_claim_by_id_lease(text,text,interval) FROM PUBLIC, anon, authenticated;
