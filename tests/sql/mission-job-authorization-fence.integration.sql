\set ON_ERROR_STOP on

-- A SECURITY DEFINER status RPC must not be callable by public/browser roles.
DO $function$
BEGIN
  IF has_function_privilege('anon','public.execution_job_authorization_status_gateway(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon role must not execute authorization status RPC';
  END IF;
  IF has_function_privilege('authenticated','public.execution_job_authorization_status_gateway(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role must not execute authorization status RPC';
  END IF;
  IF NOT has_function_privilege('service_role','public.execution_job_authorization_status_gateway(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute authorization status RPC';
  END IF;
END;
$function$;

-- Enqueue is rejected for a mission that is already blocked.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_blocked_enqueue','blocked');
DO $function$
BEGIN
  BEGIN
    PERFORM public.enqueue_execution_job_gateway('job_reject_001','mi_blocked_enqueue','device-test','shell.execute','echo should-not-run',NULL,10000,'{}'::jsonb,'{}'::jsonb);
    RAISE EXCEPTION 'expected enqueue to reject blocked mission';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM aria_internal.execution_jobs WHERE job_id='job_reject_001') THEN
    RAISE EXCEPTION 'blocked mission created an execution job';
  END IF;
END;
$function$;

-- A queued job is terminalized in the same transaction as mission revocation.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_queued_to_block','running');
SELECT public.enqueue_execution_job_gateway('job_queued_001','mi_queued_to_block','device-test','shell.execute','echo queued',NULL,10000,'{}'::jsonb,'{}'::jsonb);
UPDATE aria_internal.mission_state SET status='blocked' WHERE mission_id='mi_queued_to_block';
DO $function$
DECLARE r aria_internal.execution_jobs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM aria_internal.execution_jobs WHERE job_id='job_queued_001';
  IF r.status <> 'blocked' OR r.completed_at IS NULL OR r.lease_owner IS NOT NULL OR r.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'queued job did not terminalize coherently: %', row_to_json(r);
  END IF;
END;
$function$;

-- A job claimed immediately before revocation must be cancelled and cannot start.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_claim_to_block','running');
SELECT public.enqueue_execution_job_gateway('job_claim_001','mi_claim_to_block','device-test','shell.execute','echo claimed',NULL,10000,'{}'::jsonb,'{}'::jsonb);
SELECT public.claim_execution_job_gateway('device-test');
UPDATE aria_internal.mission_state SET status='blocked' WHERE mission_id='mi_claim_to_block';
DO $function$
DECLARE r aria_internal.execution_jobs%ROWTYPE; started jsonb;
BEGIN
  SELECT * INTO r FROM aria_internal.execution_jobs WHERE job_id='job_claim_001';
  IF r.status <> 'cancelled' OR r.completed_at IS NULL OR r.lease_owner IS NOT NULL OR r.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'claimed job did not terminalize coherently: %', row_to_json(r);
  END IF;
  started := public.start_execution_job_gateway('job_claim_001','device-test');
  IF started IS NOT NULL THEN RAISE EXCEPTION 'unauthorized claimed job was started: %', started; END IF;
END;
$function$;

-- A pre-migration queued row attached to an already-blocked mission is cancelled at claim.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_legacy_blocked','blocked');
INSERT INTO aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,status,lease_owner,lease_until)
VALUES ('job_legacy_001','mi_legacy_blocked','device-test','shell.execute','echo legacy','queued',NULL,NULL);
DO $function$
DECLARE claimed jsonb; r aria_internal.execution_jobs%ROWTYPE;
BEGIN
  claimed := public.claim_execution_job_gateway('device-test');
  IF claimed IS NOT NULL THEN RAISE EXCEPTION 'claim returned unauthorized job: %', claimed; END IF;
  SELECT * INTO r FROM aria_internal.execution_jobs WHERE job_id='job_legacy_001';
  IF r.status <> 'cancelled' OR r.completed_at IS NULL OR r.lease_owner IS NOT NULL OR r.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'legacy job did not terminalize on claim: %', row_to_json(r);
  END IF;
END;
$function$;

-- A legacy claimed row is denied by the start gateway when its mission is blocked.
INSERT INTO aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,status,claimed_at,lease_owner,lease_until)
VALUES ('job_legacy_claim','mi_legacy_blocked','device-test','shell.execute','echo no-start','claimed',clock_timestamp(),'legacy-lease',clock_timestamp()+interval '1 minute');
DO $function$
DECLARE started jsonb; r aria_internal.execution_jobs%ROWTYPE;
BEGIN
  started := public.start_execution_job_gateway('job_legacy_claim','device-test');
  IF started IS NOT NULL THEN RAISE EXCEPTION 'start accepted an unauthorized legacy claim: %', started; END IF;
  SELECT * INTO r FROM aria_internal.execution_jobs WHERE job_id='job_legacy_claim';
  IF r.status <> 'cancelled' OR r.completed_at IS NULL OR r.lease_owner IS NOT NULL OR r.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'legacy claim was not terminalized on start: %', row_to_json(r);
  END IF;
END;
$function$;

-- Valid execution remains possible for a live authorized mission.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_valid_start','running');
SELECT public.enqueue_execution_job_gateway('job_valid_001','mi_valid_start','device-test','shell.execute','echo ok',NULL,10000,'{}'::jsonb,'{}'::jsonb);
SELECT public.claim_execution_job_gateway('device-test');
DO $function$
DECLARE started jsonb;
BEGIN
  started := public.start_execution_job_gateway('job_valid_001','device-test');
  IF started IS NULL OR started->>'status' <> 'running' THEN
    RAISE EXCEPTION 'authorized job failed to start: %', started;
  END IF;
END;
$function$;


-- Running jobs are revoked on mission block, and the physical agent's status monitor can observe cancellation.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_running_revoke','running');
SELECT public.enqueue_execution_job_gateway('job_running_001','mi_running_revoke','device-test','shell.execute','echo running',NULL,10000,'{}'::jsonb,'{}'::jsonb);
SELECT public.claim_execution_job_gateway('device-test');
DO $function$
DECLARE started jsonb;
BEGIN
  started := public.start_execution_job_gateway('job_running_001','device-test');
  IF started IS NULL OR started->>'status' <> 'running' THEN
    RAISE EXCEPTION 'test job was not started: %', started;
  END IF;
END;
$function$;
UPDATE aria_internal.mission_state SET status='blocked' WHERE mission_id='mi_running_revoke';
DO $function$
DECLARE r aria_internal.execution_jobs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM aria_internal.execution_jobs WHERE job_id='job_running_001';
  IF r.status <> 'cancelled' OR r.completed_at IS NULL OR r.lease_owner IS NOT NULL OR r.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'running job not revoked coherently: %', row_to_json(r);
  END IF;
END;
$function$;



-- A late agent success must never overwrite a job revoked by the parent mission.
DO $function$
DECLARE
  late_result jsonb;
  r aria_internal.execution_jobs%ROWTYPE;
BEGIN
  late_result := public.complete_execution_job_gateway(
    'job_running_001','device-test','succeeded',0,'SAFE_AUTONOMY_OK','',
    jsonb_build_object('status','succeeded','exit_code',0,'stdout','SAFE_AUTONOMY_OK')
  );
  IF late_result IS NOT NULL THEN
    RAISE EXCEPTION 'late completion must be rejected after mission revocation: %',late_result;
  END IF;

  SELECT * INTO r FROM aria_internal.execution_jobs WHERE job_id='job_running_001';
  IF r.status <> 'cancelled' OR r.exit_code IS NOT NULL OR r.stdout IS NOT NULL THEN
    RAISE EXCEPTION 'late result resurrected a revoked job: %',row_to_json(r);
  END IF;

  IF EXISTS (SELECT 1 FROM aria_internal.execution_job_events
              WHERE job_id='job_running_001' AND event_type='job.succeeded') THEN
    RAISE EXCEPTION 'late result emitted job.succeeded evidence after revocation';
  END IF;
END;
$function$;

-- The authenticated status RPC sees the authorized state and then a revocation.
INSERT INTO aria_internal.mission_state(mission_id,status) VALUES ('mi_status_check','running');
SELECT public.enqueue_execution_job_gateway('job_status_001','mi_status_check','device-test','shell.execute','echo status',NULL,10000,'{}'::jsonb,'{}'::jsonb);
SELECT public.claim_execution_job_gateway('device-test');
SELECT public.start_execution_job_gateway('job_status_001','device-test');
DO $function$
DECLARE state jsonb;
BEGIN
  state := public.execution_job_authorization_status_gateway('job_status_001','device-test');
  IF state->>'authorized' <> 'true' OR state->>'status' <> 'running' THEN
    RAISE EXCEPTION 'active job status should be authorized: %',state;
  END IF;
END;
$function$;
UPDATE aria_internal.mission_state SET status='blocked' WHERE mission_id='mi_status_check';
DO $function$
DECLARE state jsonb;
BEGIN
  state := public.execution_job_authorization_status_gateway('job_status_001','device-test');
  IF state->>'authorized' <> 'false' OR state->>'status' <> 'cancelled' OR state->>'mission_status' <> 'blocked' THEN
    RAISE EXCEPTION 'revoked job status should fail closed: %',state;
  END IF;
END;
$function$;
SELECT 'MISSION_JOB_AUTHORIZATION_FENCE_INTEGRATION_PASS' AS result;
