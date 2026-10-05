-- Align the governed mission queue with the Android Termux notification capability.
-- The Android agent already implements android.notification; this migration adds
-- the missing enqueue boundary without broadening unrelated device operations.

CREATE OR REPLACE FUNCTION aria_internal.enqueue_android_notification_job(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
  p_command text,
  p_cwd text DEFAULT NULL,
  p_timeout_ms integer DEFAULT 30000,
  p_policy jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  r jsonb;
  v_payload jsonb;
  v_key text;
  v_status text;
  v_agent_type text;
  v_capabilities jsonb;
BEGIN
  IF p_job_id IS NULL OR length(trim(p_job_id)) < 8 THEN RAISE EXCEPTION 'invalid job id'; END IF;
  IF p_mission_id IS NULL OR length(trim(p_mission_id)) < 1 THEN RAISE EXCEPTION 'mission id required'; END IF;
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN RAISE EXCEPTION 'device id required'; END IF;
  IF p_command IS NULL OR length(trim(p_command)) = 0 THEN RAISE EXCEPTION 'command required'; END IF;
  IF p_cwd IS NOT NULL THEN RAISE EXCEPTION 'android.notification does not accept cwd'; END IF;
  IF p_timeout_ms IS NULL OR p_timeout_ms < 1000 OR p_timeout_ms > 300000 THEN RAISE EXCEPTION 'invalid timeout'; END IF;

  BEGIN
    v_payload := p_command::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'android.notification payload must be valid JSON';
  END;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'android.notification payload must be an object';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_payload) LOOP
    IF v_key NOT IN ('notification_id','title','message','severity','kind','mission_id','priority','action') THEN
      RAISE EXCEPTION 'android.notification payload contains unsupported fields';
    END IF;
  END LOOP;

  IF NOT (v_payload ? 'notification_id')
     OR jsonb_typeof(v_payload->'notification_id') <> 'string'
     OR length(trim(v_payload->>'notification_id')) = 0
     OR length(v_payload->>'notification_id') > 200 THEN
    RAISE EXCEPTION 'android.notification notification_id invalid';
  END IF;

  IF NOT (v_payload ? 'title')
     OR jsonb_typeof(v_payload->'title') <> 'string'
     OR length(trim(v_payload->>'title')) = 0
     OR length(v_payload->>'title') > 120 THEN
    RAISE EXCEPTION 'android.notification title invalid';
  END IF;

  IF NOT (v_payload ? 'message')
     OR jsonb_typeof(v_payload->'message') <> 'string'
     OR length(trim(v_payload->>'message')) = 0
     OR length(v_payload->>'message') > 2000 THEN
    RAISE EXCEPTION 'android.notification message invalid';
  END IF;

  IF NOT (v_payload ? 'severity')
     OR jsonb_typeof(v_payload->'severity') <> 'string'
     OR v_payload->>'severity' NOT IN ('info','success','warning','error') THEN
    RAISE EXCEPTION 'android.notification severity unsupported';
  END IF;

  IF NOT (v_payload ? 'kind')
     OR jsonb_typeof(v_payload->'kind') <> 'string'
     OR length(trim(v_payload->>'kind')) = 0
     OR length(v_payload->>'kind') > 80 THEN
    RAISE EXCEPTION 'android.notification kind invalid';
  END IF;

  IF NOT (v_payload ? 'mission_id')
     OR jsonb_typeof(v_payload->'mission_id') <> 'string'
     OR length(trim(v_payload->>'mission_id')) = 0
     OR length(v_payload->>'mission_id') > 200 THEN
    RAISE EXCEPTION 'android.notification mission_id invalid';
  END IF;

  IF NOT (v_payload ? 'priority')
     OR jsonb_typeof(v_payload->'priority') <> 'string'
     OR v_payload->>'priority' NOT IN ('default','high','max') THEN
    RAISE EXCEPTION 'android.notification priority unsupported';
  END IF;

  IF v_payload ? 'action' AND (
    jsonb_typeof(v_payload->'action') <> 'string'
    OR length(v_payload->>'action') > 120
  ) THEN
    RAISE EXCEPTION 'android.notification action invalid';
  END IF;

  SELECT status, agent_type, capabilities
    INTO v_status, v_agent_type, v_capabilities
    FROM aria_internal.device_registry
   WHERE device_id = trim(p_device_id);

  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_registered'; END IF;
  IF v_status = 'disabled' THEN RAISE EXCEPTION 'device_disabled'; END IF;
  IF coalesce(v_agent_type,'') <> 'android-termux' THEN
    RAISE EXCEPTION 'android.notification requires android-termux device';
  END IF;
  IF NOT (coalesce(v_capabilities,'[]'::jsonb) @> '["notifications.push"]'::jsonb) THEN
    RAISE EXCEPTION 'android.notification capability_missing';
  END IF;

  INSERT INTO aria_internal.execution_jobs(
    job_id, mission_id, device_id, operation, command, cwd, timeout_ms,
    policy, status, metadata
  )
  VALUES(
    trim(p_job_id), p_mission_id, p_device_id, 'android.notification',
    p_command, NULL, p_timeout_ms, coalesce(p_policy,'{}'::jsonb),
    'queued', coalesce(p_metadata,'{}'::jsonb)
  )
  ON CONFLICT (job_id) DO NOTHING;

  SELECT to_jsonb(x) INTO r
  FROM aria_internal.execution_jobs x
  WHERE x.job_id = trim(p_job_id);

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION aria_internal.enqueue_android_notification_job(
  text,text,text,text,text,integer,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION aria_internal.enqueue_android_notification_job(
  text,text,text,text,text,integer,jsonb,jsonb
) TO service_role;

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
  IF p_operation = 'computer.use.android' THEN
    RETURN aria_internal.enqueue_android_ui_job(
      p_job_id, p_mission_id, p_device_id, p_command,
      p_cwd, p_timeout_ms, p_policy, p_metadata
    );
  END IF;

  IF p_operation = 'android.notification' THEN
    RETURN aria_internal.enqueue_android_notification_job(
      p_job_id, p_mission_id, p_device_id, p_command,
      p_cwd, p_timeout_ms, p_policy, p_metadata
    );
  END IF;

  RETURN aria_internal.enqueue_execution_job(
    p_job_id, p_mission_id, p_device_id, p_operation, p_command,
    p_cwd, p_timeout_ms, p_policy, p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_execution_job_gateway(
  text,text,text,text,text,text,integer,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_execution_job_gateway(
  text,text,text,text,text,text,integer,jsonb,jsonb
) TO service_role;
