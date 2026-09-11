-- ARIA Device Execution — controlled ollama.qwen3 operation.
-- Extends the existing enqueue contract without creating a new job system.

CREATE OR REPLACE FUNCTION aria_internal.enqueue_execution_job(
  p_job_id text, p_mission_id text, p_device_id text, p_operation text, p_command text,
  p_cwd text DEFAULT NULL, p_timeout_ms integer DEFAULT 120000,
  p_policy jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = aria_internal, pg_catalog
AS $$
DECLARE r jsonb; v_payload jsonb; v_key text;
BEGIN
  IF p_job_id IS NULL OR length(trim(p_job_id)) < 8 THEN RAISE EXCEPTION 'invalid job id'; END IF;
  IF p_mission_id IS NULL OR length(trim(p_mission_id)) < 1 THEN RAISE EXCEPTION 'mission id required'; END IF;
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN RAISE EXCEPTION 'device id required'; END IF;
  IF p_operation NOT IN ('shell.execute', 'ollama.qwen3') THEN RAISE EXCEPTION 'unsupported operation'; END IF;
  IF p_command IS NULL OR length(trim(p_command)) = 0 THEN RAISE EXCEPTION 'command required'; END IF;
  IF p_timeout_ms IS NULL OR p_timeout_ms < 1000 OR p_timeout_ms > 3600000 THEN RAISE EXCEPTION 'invalid timeout'; END IF;

  IF p_operation = 'ollama.qwen3' THEN
    BEGIN v_payload := p_command::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'ollama.qwen3 payload must be valid JSON'; END;
    IF jsonb_typeof(v_payload) <> 'object' THEN RAISE EXCEPTION 'ollama.qwen3 payload must be an object'; END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_payload) LOOP
      IF v_key NOT IN ('prompt', 'model', 'timeout_ms') THEN RAISE EXCEPTION 'ollama.qwen3 payload contains unsupported fields'; END IF;
    END LOOP;
    IF NOT (v_payload ? 'prompt') OR jsonb_typeof(v_payload->'prompt') <> 'string' OR length(trim(v_payload->>'prompt')) = 0 THEN RAISE EXCEPTION 'ollama.qwen3 prompt required'; END IF;
    IF v_payload ? 'model' AND v_payload->>'model' <> 'qwen3:4b' THEN RAISE EXCEPTION 'ollama.qwen3 model must be qwen3:4b'; END IF;
    IF v_payload ? 'timeout_ms' AND (jsonb_typeof(v_payload->'timeout_ms') <> 'number' OR (v_payload->>'timeout_ms')::numeric < 1000 OR (v_payload->>'timeout_ms')::numeric > 3600000 OR (v_payload->>'timeout_ms')::numeric <> trunc((v_payload->>'timeout_ms')::numeric)) THEN RAISE EXCEPTION 'ollama.qwen3 timeout_ms must be an integer between 1000 and 3600000'; END IF;
    IF p_cwd IS NOT NULL THEN RAISE EXCEPTION 'ollama.qwen3 does not accept cwd'; END IF;
  END IF;

  INSERT INTO aria_internal.execution_jobs(job_id, mission_id, device_id, operation, command, cwd, timeout_ms, policy, status, metadata)
  VALUES(p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,coalesce(p_policy,'{}'::jsonb),'queued',coalesce(p_metadata,'{}'::jsonb))
  ON CONFLICT (job_id) DO NOTHING;
  SELECT to_jsonb(x) INTO r FROM aria_internal.execution_jobs x WHERE x.job_id=p_job_id;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_execution_job_gateway(
  p_job_id text, p_mission_id text, p_device_id text, p_operation text, p_command text,
  p_cwd text DEFAULT NULL, p_timeout_ms integer DEFAULT 120000,
  p_policy jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, aria_internal
AS $$ BEGIN RETURN aria_internal.enqueue_execution_job(p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,p_policy,p_metadata); END; $$;

REVOKE ALL ON FUNCTION public.enqueue_execution_job_gateway(text,text,text,text,text,text,integer,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_execution_job_gateway(text,text,text,text,text,text,integer,jsonb,jsonb) TO service_role;
