-- Governed device target resolution + queued execution-job recovery.
-- Only queued jobs may be rebound to another compatible online device.
-- Running jobs are never silently reassigned.

CREATE OR REPLACE FUNCTION aria_internal.claim_execution_job(p_device_id text)
RETURNS SETOF aria_internal.execution_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $function$
DECLARE
  v_device_status text;
  v_device_capabilities jsonb;
  v_job_id text;
  v_requested_device_id text;
  v_operation text;
  v_resolution_reason text;
BEGIN
  SELECT status, capabilities
    INTO v_device_status, v_device_capabilities
    FROM aria_internal.device_registry
   WHERE device_id = p_device_id;

  IF NOT FOUND OR v_device_status <> 'online' THEN
    RETURN;
  END IF;

  UPDATE aria_internal.execution_jobs
     SET status='queued',
         claimed_at=NULL,
         lease_owner=NULL,
         lease_until=NULL,
         updated_at=clock_timestamp(),
         recovery_count=coalesce(recovery_count,0)+1,
         stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'requeued: claim lease expired before start')
   WHERE status='claimed'
     AND completed_at IS NULL
     AND lease_until IS NOT NULL
     AND lease_until < clock_timestamp();

  FOR v_job_id, v_requested_device_id IN
    SELECT job_id, device_id
      FROM aria_internal.execution_jobs
     WHERE status='running'
       AND completed_at IS NULL
       AND lease_until IS NOT NULL
       AND lease_until < clock_timestamp()
       AND updated_at < clock_timestamp() - interval '10 seconds'
  LOOP
    UPDATE aria_internal.execution_jobs
       SET status='timeout',
           completed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           lease_owner=NULL,
           lease_until=NULL,
           recovery_count=coalesce(recovery_count,0)+1,
           exit_code=NULL,
           stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'timeout: execution lease expired while running')
     WHERE job_id=v_job_id
       AND status='running';

    INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    VALUES (
      v_job_id,
      coalesce(v_requested_device_id, p_device_id),
      'job.timeout',
      jsonb_build_object(
        'reason','stale_running_lease',
        'recovered_by_device_id',p_device_id,
        'recovered_at',clock_timestamp()
      )
    );
  END LOOP;

  SELECT q.job_id, q.device_id, q.operation
    INTO v_job_id, v_requested_device_id, v_operation
    FROM aria_internal.execution_jobs q
   WHERE q.status='queued'
     AND v_device_capabilities @> jsonb_build_array(q.operation)
     AND (
       q.device_id IS NULL
       OR q.device_id = p_device_id
       OR NOT EXISTS (
         SELECT 1
           FROM aria_internal.device_registry target
          WHERE target.device_id = q.device_id
            AND target.status = 'online'
            AND target.capabilities @> jsonb_build_array(q.operation)
       )
     )
   ORDER BY q.requested_at, q.job_id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  IF v_requested_device_id IS NULL THEN
    v_resolution_reason := 'requested_device_missing_or_unbound';
  ELSIF v_requested_device_id = p_device_id THEN
    v_resolution_reason := 'requested_device_online_and_capable';
  ELSE
    SELECT CASE
      WHEN target.device_id IS NULL THEN 'requested_device_missing'
      WHEN target.status <> 'online' THEN 'requested_device_offline'
      ELSE 'requested_device_online_but_incompatible'
    END
      INTO v_resolution_reason
      FROM aria_internal.device_registry target
     WHERE target.device_id = v_requested_device_id;

    v_resolution_reason := coalesce(v_resolution_reason, 'requested_device_missing');
  END IF;

  RETURN QUERY
  UPDATE aria_internal.execution_jobs j
     SET device_id=p_device_id,
         status='claimed',
         claimed_at=clock_timestamp(),
         lease_owner=md5(p_device_id || ':' || clock_timestamp()::text || ':' || random()::text),
         lease_until=clock_timestamp() + ((greatest(j.timeout_ms, 1000) + 60000)::numeric * interval '1 millisecond'),
         updated_at=clock_timestamp()
   WHERE j.job_id=v_job_id
     AND j.status='queued'
   RETURNING j.*;

  IF v_requested_device_id IS DISTINCT FROM p_device_id THEN
    INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    VALUES (
      v_job_id,
      p_device_id,
      'job.device_rerouted',
      jsonb_build_object(
        'requested_device_id',v_requested_device_id,
        'resolved_device_id',p_device_id,
        'operation',v_operation,
        'reason',v_resolution_reason,
        'queued_only',true,
        'running_reassignment',false,
        'resolved_at',clock_timestamp()
      )
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.claim_execution_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.claim_execution_job(text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r
    FROM aria_internal.claim_execution_job(p_device_id) x
   LIMIT 1;
  RETURN r;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_execution_job_gateway(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_job_gateway(text) TO service_role;
