-- Resume only the exact async job persisted by the waiting mission.
-- The legacy runner tick alone cannot resume a mission left in "waiting":
-- the canonical runner ignores it as idle. Promote only the exact authorized
-- completion to queued, then enqueue the canonical runner tick.
CREATE OR REPLACE FUNCTION aria_internal.schedule_mission_runner_after_execution_job(
  p_mission_id text,
  p_job_status text,
  p_job_id text,
  p_device_id text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  v_mission_status text;
  v_checkpoint jsonb;
  v_job_status text;
  v_request_id bigint;
  v_resumed boolean := false;
BEGIN
  IF p_mission_id IS NULL OR length(trim(p_mission_id)) = 0
     OR p_job_id IS NULL OR length(trim(p_job_id)) = 0 THEN
    RETURN NULL;
  END IF;

  IF p_job_status IS NULL OR p_job_status NOT IN ('succeeded','failed','timeout') THEN
    RETURN NULL;
  END IF;

  SELECT m.status, coalesce(m.checkpoint, '{}'::jsonb)
    INTO v_mission_status, v_checkpoint
    FROM aria_internal.mission_state m
   WHERE m.mission_id = p_mission_id
   FOR UPDATE;

  IF NOT FOUND OR v_mission_status IN ('succeeded','failed','blocked','cancelled') THEN
    RETURN NULL;
  END IF;

  -- Do not trust a caller-provided status/ID: it must describe the completed
  -- job row that belongs to this mission and physical device.
  SELECT j.status
    INTO v_job_status
    FROM aria_internal.execution_jobs j
   WHERE j.job_id = p_job_id
     AND j.mission_id = p_mission_id
     AND j.device_id = p_device_id
     AND j.completed_at IS NOT NULL;

  IF NOT FOUND OR v_job_status IS DISTINCT FROM p_job_status THEN
    RETURN NULL;
  END IF;

  IF v_mission_status IN ('waiting','paused') THEN
    -- Only an exact, already-completed async job may resume a waiting mission.
    -- A Human Gate pause, alternate-strategy wait, unrelated job, or stale
    -- completion remains a no-op and cannot wake the mission.
    IF coalesce(v_checkpoint->'recovery'->>'status','')
         <> 'waiting_for_async_executor' THEN
      RETURN NULL;
    END IF;
    IF jsonb_typeof(v_checkpoint->'pending_jobs') IS DISTINCT FROM 'object' THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM jsonb_each(v_checkpoint->'pending_jobs') AS pending(step_id, job)
       WHERE pending.job->>'job_id' = p_job_id
    ) THEN
      RETURN NULL;
    END IF;

    UPDATE aria_internal.mission_state m
       SET status = 'queued',
           next_action = 'resume: completed async device job ' || left(p_job_id,128),
           last_stderr = NULL,
           checkpoint = jsonb_set(
             coalesce(m.checkpoint,'{}'::jsonb),
             '{recovery}',
             coalesce(m.checkpoint->'recovery','{}'::jsonb)
               || jsonb_build_object(
                    'status','clear',
                    'resumed_from','waiting_for_async_executor',
                    'completed_job_id',p_job_id,
                    'completed_job_status',p_job_status,
                    'resumed_at',clock_timestamp()
                  ),
             true
           ),
           lease_owner = NULL,
           lease_until = NULL,
           updated_at = clock_timestamp()
     WHERE m.mission_id = p_mission_id
       AND m.status = v_mission_status
       AND coalesce(m.checkpoint->'recovery'->>'status','')
             = 'waiting_for_async_executor'
       AND EXISTS (
         SELECT 1
           FROM jsonb_each(coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)) AS pending(step_id, job)
          WHERE pending.job->>'job_id' = p_job_id
       )
     RETURNING true INTO v_resumed;

    IF NOT coalesce(v_resumed,false) THEN
      RETURN NULL;
    END IF;

    INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    VALUES (
      p_job_id,
      p_device_id,
      'mission.async_executor_resumed',
      jsonb_build_object(
        'mission_id',p_mission_id,
        'job_status',p_job_status,
        'from_status',v_mission_status,
        'to_status','queued',
        'reason','exact_pending_async_job_completed',
        'at',clock_timestamp()
      )
    );
  ELSIF v_mission_status NOT IN ('queued','running','planning') THEN
    RETURN NULL;
  END IF;

  -- The existing helper enqueues the governed canonical runner request. The
  -- mission status update above commits with this transaction, so the queued
  -- tick observes the resumable state rather than returning "idle" on waiting.
  BEGIN
    SELECT aria_internal.runner_tick_for_mission(p_mission_id)
      INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    VALUES (
      p_job_id,
      p_device_id,
      'mission.continuation_tick_failed',
      jsonb_build_object(
        'mission_id',p_mission_id,
        'job_status',p_job_status,
        'error',SQLERRM,
        'recovery','supervisor_tick',
        'at',clock_timestamp()
      )
    );
    RETURN NULL;
  END;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.schedule_mission_runner_after_execution_job(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
