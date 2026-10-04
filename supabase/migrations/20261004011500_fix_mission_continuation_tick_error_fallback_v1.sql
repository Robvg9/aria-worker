-- ARIA mission continuation v1 follow-up
-- Make the continuation transport failure path evidence-safe. The previous
-- migration established the immediate runner tick, but its exception telemetry
-- must carry the completed job identity because execution_job_events.job_id is
-- NOT NULL.

CREATE OR REPLACE FUNCTION aria_internal.schedule_mission_runner_after_execution_job(
  p_mission_id text,
  p_job_status text,
  p_job_id text,
  p_device_id text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE
  v_mission_status text;
  v_request_id bigint;
BEGIN
  IF p_mission_id IS NULL OR length(trim(p_mission_id)) = 0 THEN
    RETURN NULL;
  END IF;

  IF p_job_status NOT IN ('succeeded','failed','timeout') THEN
    RETURN NULL;
  END IF;

  SELECT status
    INTO v_mission_status
    FROM aria_internal.mission_state
   WHERE mission_id = p_mission_id;

  IF NOT FOUND OR v_mission_status IN ('succeeded','failed','blocked','cancelled') THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT aria_internal.runner_tick_for_mission(p_mission_id)
      INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO aria_internal.execution_job_events(
      job_id,
      device_id,
      event_type,
      payload
    )
    VALUES (
      p_job_id,
      p_device_id,
      'mission.continuation_tick_failed',
      jsonb_build_object(
        'mission_id', p_mission_id,
        'job_status', p_job_status,
        'error', SQLERRM,
        'recovery', 'supervisor_tick'
      )
    );
    RETURN NULL;
  END;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.schedule_mission_runner_after_execution_job(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.schedule_mission_runner_after_execution_job(text,text,text,text)
  TO service_role;

COMMENT ON FUNCTION aria_internal.schedule_mission_runner_after_execution_job(text,text,text,text)
IS 'Immediately resumes the canonical mission runner after a terminal device execution job; failure is evidenced on the same job and supervisor cadence remains fallback.';

CREATE OR REPLACE FUNCTION public.complete_execution_job_gateway(
  p_job_id text,
  p_device_id text,
  p_status text,
  p_exit_code integer,
  p_stdout text,
  p_stderr text,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE
  r jsonb;
  v_mission_id text;
BEGIN
  UPDATE aria_internal.execution_jobs
  SET status = p_status,
      exit_code = p_exit_code,
      stdout = p_stdout,
      stderr = p_stderr,
      result = p_result,
      completed_at = now(),
      updated_at = now(),
      lease_owner = NULL,
      lease_until = NULL
  WHERE job_id = p_job_id
    AND device_id = p_device_id
    AND status IN ('running','claimed')
  RETURNING to_jsonb(execution_jobs.*), mission_id
    INTO r, v_mission_id;

  IF r IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO aria_internal.execution_job_events(
    job_id,
    device_id,
    event_type,
    payload
  )
  VALUES (
    p_job_id,
    p_device_id,
    'job.' || p_status,
    jsonb_build_object(
      'exit_code', p_exit_code,
      'duration_ms', coalesce((p_result->>'duration_ms')::numeric, NULL),
      'mission_id', v_mission_id
    )
  );

  IF p_status IN ('succeeded','failed','timeout') THEN
    PERFORM aria_internal.schedule_mission_runner_after_execution_job(
      v_mission_id,
      p_status,
      p_job_id,
      p_device_id
    );
  END IF;

  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_execution_job_gateway(
  text,text,text,integer,text,text,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_execution_job_gateway(
  text,text,text,integer,text,text,jsonb
) TO service_role;
