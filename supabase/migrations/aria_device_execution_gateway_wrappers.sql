-- AF-3 live gateway compatibility / security boundary.
-- The public schema exposes only SECURITY DEFINER wrappers; internal tables stay private.

CREATE OR REPLACE FUNCTION public.enroll_device(p_device_id text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aria_internal
AS $$
BEGIN
  RETURN aria_internal.enroll_device(p_device_id, p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_device_gateway(p_device_id text, p_capabilities jsonb, p_agent_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
DECLARE r jsonb;
BEGIN
  UPDATE aria_internal.device_registry
  SET status='online',
      capabilities=coalesce(p_capabilities,capabilities),
      metadata=jsonb_build_object('agent_type',coalesce(p_agent_type,agent_type)),
      last_seen_at=now(),
      updated_at=now()
  WHERE device_id=p_device_id
  RETURNING to_jsonb(device_registry.*) INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
DECLARE r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r
  FROM aria_internal.claim_execution_job(p_device_id) x
  LIMIT 1;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_execution_job_gateway(p_job_id text, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
DECLARE r jsonb;
BEGIN
  UPDATE aria_internal.execution_jobs
  SET status='running', started_at=now(), updated_at=now()
  WHERE job_id=p_job_id AND device_id=p_device_id AND status='claimed'
  RETURNING to_jsonb(execution_jobs.*) INTO r;
  RETURN r;
END;
$$;

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
AS $$
DECLARE r jsonb;
BEGIN
  UPDATE aria_internal.execution_jobs
  SET status=p_status,
      exit_code=p_exit_code,
      stdout=p_stdout,
      stderr=p_stderr,
      result=p_result,
      completed_at=now(),
      updated_at=now()
  WHERE job_id=p_job_id
    AND device_id=p_device_id
    AND status IN ('running','claimed')
  RETURNING to_jsonb(execution_jobs.*) INTO r;

  IF r IS NULL THEN RETURN NULL; END IF;

  INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  VALUES (
    p_job_id,
    p_device_id,
    'job.'||p_status,
    jsonb_build_object(
      'exit_code',p_exit_code,
      'duration_ms',coalesce((p_result->>'duration_ms')::numeric,null)
    )
  );
  RETURN r;
END;
$$;

-- Device agents must never invoke these database functions directly.
REVOKE EXECUTE ON FUNCTION public.enroll_device(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.heartbeat_device_gateway(text,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_execution_job_gateway(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_execution_job_gateway(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_execution_job_gateway(text,text,text,integer,text,text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enroll_device(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_device_gateway(text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_execution_job_gateway(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_execution_job_gateway(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_execution_job_gateway(text,text,text,integer,text,text,jsonb) TO service_role;
