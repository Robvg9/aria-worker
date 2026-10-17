\set ON_ERROR_STOP on
DO $function$
DECLARE
  started jsonb;
  v_status text;
  v_mission_status text;
BEGIN
  started := public.start_execution_job_gateway('job_concurrent_race','device-test');
  IF started IS NOT NULL THEN
    RAISE EXCEPTION 'start gateway accepted job after mission block won the race: %',started;
  END IF;
  SELECT j.status,m.status INTO v_status,v_mission_status
    FROM aria_internal.execution_jobs j
    JOIN aria_internal.mission_state m USING(mission_id)
   WHERE j.job_id='job_concurrent_race';
  IF v_mission_status <> 'blocked' OR v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'race ended in incoherent states: mission %, job %',v_mission_status,v_status;
  END IF;
END;
$function$;
SELECT 'MISSION_JOB_AUTHORIZATION_FENCE_CONCURRENT_RACE_PASS' AS result;
