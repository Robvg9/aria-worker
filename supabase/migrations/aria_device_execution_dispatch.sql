-- ARIA AF-4 — server-side device dispatch boundary
-- Public RPC wrappers are service-role-only; devices never receive this capability.

CREATE OR REPLACE FUNCTION aria_internal.enqueue_execution_job(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
  p_operation text,
  p_command text,
  p_cwd text DEFAULT NULL,
  p_timeout_ms integer DEFAULT 120000,
  p_policy jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE r jsonb;
BEGIN
  IF p_job_id IS NULL OR length(trim(p_job_id)) < 8 THEN
    RAISE EXCEPTION 'invalid job id';
  END IF;
  IF p_mission_id IS NULL OR length(trim(p_mission_id)) < 1 THEN
    RAISE EXCEPTION 'mission id required';
  END IF;
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN
    RAISE EXCEPTION 'device id required';
  END IF;
  IF p_operation IS NULL OR p_operation <> 'shell.execute' THEN
    RAISE EXCEPTION 'unsupported operation';
  END IF;
  IF p_command IS NULL OR length(trim(p_command)) = 0 THEN
    RAISE EXCEPTION 'command required';
  END IF;
  IF p_timeout_ms IS NULL OR p_timeout_ms < 1000 OR p_timeout_ms > 3600000 THEN
    RAISE EXCEPTION 'invalid timeout';
  END IF;

  INSERT INTO aria_internal.execution_jobs(
    job_id, mission_id, device_id, operation, command, cwd, timeout_ms, policy, status, metadata
  ) VALUES (
    p_job_id, p_mission_id, p_device_id, p_operation, p_command, p_cwd, p_timeout_ms,
    coalesce(p_policy, '{}'::jsonb), 'queued', coalesce(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (job_id) DO NOTHING;

  SELECT to_jsonb(x) INTO r
  FROM aria_internal.execution_jobs x
  WHERE x.job_id = p_job_id;

  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_execution_job_gateway(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
  p_operation text,
  p_command text,
  p_cwd text DEFAULT NULL,
  p_timeout_ms integer DEFAULT 120000,
  p_policy jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
BEGIN
  RETURN aria_internal.enqueue_execution_job(
    p_job_id, p_mission_id, p_device_id, p_operation, p_command,
    p_cwd, p_timeout_ms, p_policy, p_metadata
  );
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.get_execution_job(p_job_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r FROM aria_internal.execution_jobs x WHERE x.job_id = p_job_id;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_execution_job_gateway(p_job_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
BEGIN
  RETURN aria_internal.get_execution_job(p_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_execution_job_gateway(text,text,text,text,text,text,integer,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_execution_job_gateway(text,text,text,text,text,text,integer,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_execution_job_gateway(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_execution_job_gateway(text) TO service_role;
REVOKE ALL ON FUNCTION aria_internal.enqueue_execution_job(text,text,text,text,text,text,integer,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.get_execution_job(text) FROM PUBLIC, anon, authenticated;
