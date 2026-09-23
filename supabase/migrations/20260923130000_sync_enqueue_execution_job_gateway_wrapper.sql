-- Keep the public service-role gateway wrapper aligned with the canonical
-- internal enqueue contract, including physical Android UI jobs.
-- The internal function owns validation; the wrapper must not duplicate a
-- stale allow-list of operations.
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
    p_job_id,
    p_mission_id,
    p_device_id,
    p_operation,
    p_command,
    p_cwd,
    p_timeout_ms,
    p_policy,
    p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_execution_job_gateway(
  text,text,text,text,text,text,integer,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_execution_job_gateway(
  text,text,text,text,text,text,integer,jsonb,jsonb
) TO service_role;
