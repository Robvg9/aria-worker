-- Allow the governed Android Accessibility swipe action through the canonical execution queue.
-- This is required by the v1.1.21 / versionCode 27 physical RWHT agent.

CREATE OR REPLACE FUNCTION aria_internal.enqueue_android_ui_job(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
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
DECLARE
  r jsonb;
  v_payload jsonb;
  v_key text;
  v_action jsonb;
  v_action_name text;
  v_operation text;
  v_device_status text;
BEGIN
  IF p_job_id IS NULL OR length(trim(p_job_id)) < 8 THEN RAISE EXCEPTION 'invalid job id'; END IF;
  IF p_mission_id IS NULL OR length(trim(p_mission_id)) < 1 THEN RAISE EXCEPTION 'mission id required'; END IF;
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN RAISE EXCEPTION 'device id required'; END IF;
  IF p_command IS NULL OR length(trim(p_command)) = 0 THEN RAISE EXCEPTION 'command required'; END IF;
  IF p_timeout_ms IS NULL OR p_timeout_ms < 1000 OR p_timeout_ms > 3600000 THEN RAISE EXCEPTION 'invalid timeout'; END IF;

  BEGIN
    v_payload := p_command::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'computer.use.android payload must be valid JSON';
  END;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'computer.use.android payload must be an object';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_payload) LOOP
    IF v_key NOT IN (
      'operation','action','target_package','allow_any_app','allowed_hosts',
      'secret_ref','mode','goal','history','observation','mission_id','request_id',
      'start_url','start_app','max_steps'
    ) THEN
      RAISE EXCEPTION 'computer.use.android payload contains unsupported fields';
    END IF;
  END LOOP;

  IF v_payload ? 'target_package' AND (
    jsonb_typeof(v_payload->'target_package') <> 'string'
    OR length(trim(v_payload->>'target_package')) > 200
  ) THEN RAISE EXCEPTION 'computer.use.android target_package invalid'; END IF;

  IF v_payload ? 'allow_any_app' AND jsonb_typeof(v_payload->'allow_any_app') <> 'boolean' THEN
    RAISE EXCEPTION 'computer.use.android allow_any_app invalid';
  END IF;

  IF v_payload ? 'allowed_hosts' AND (
    jsonb_typeof(v_payload->'allowed_hosts') <> 'array'
    OR jsonb_array_length(v_payload->'allowed_hosts') > 20
  ) THEN
    RAISE EXCEPTION 'computer.use.android allowed_hosts invalid';
  END IF;

  IF v_payload ? 'secret_ref' AND (
    jsonb_typeof(v_payload->'secret_ref') <> 'string'
    OR NOT (v_payload->>'secret_ref' ~ '^secret://rwht/[A-Za-z0-9._:-]+$')
  ) THEN RAISE EXCEPTION 'computer.use.android secret_ref invalid'; END IF;

  IF v_payload ? 'mode' AND (
    jsonb_typeof(v_payload->'mode') <> 'string'
    OR length(trim(v_payload->>'mode')) > 64
  ) THEN RAISE EXCEPTION 'computer.use.android mode invalid'; END IF;

  IF v_payload ? 'goal' AND (
    jsonb_typeof(v_payload->'goal') <> 'string'
    OR length(v_payload->>'goal') > 4096
  ) THEN RAISE EXCEPTION 'computer.use.android goal invalid'; END IF;

  IF v_payload ? 'start_url' AND (
    jsonb_typeof(v_payload->'start_url') <> 'string'
    OR length(trim(v_payload->>'start_url')) = 0
    OR length(v_payload->>'start_url') > 2048
  ) THEN RAISE EXCEPTION 'computer.use.android start_url invalid'; END IF;

  IF v_payload ? 'start_app' AND jsonb_typeof(v_payload->'start_app') <> 'boolean' THEN
    RAISE EXCEPTION 'computer.use.android start_app invalid';
  END IF;

  IF v_payload ? 'max_steps' AND (
    jsonb_typeof(v_payload->'max_steps') <> 'number'
    OR (v_payload->>'max_steps')::numeric <> trunc((v_payload->>'max_steps')::numeric)
    OR (v_payload->>'max_steps')::numeric < 1
    OR (v_payload->>'max_steps')::numeric > 16
  ) THEN RAISE EXCEPTION 'computer.use.android max_steps invalid'; END IF;

  IF coalesce(v_payload->>'mode','') = 'autonomous_test' THEN
    IF NOT (v_payload ? 'goal') OR length(trim(v_payload->>'goal')) = 0 THEN
      RAISE EXCEPTION 'computer.use.android autonomous goal required';
    END IF;
  ELSE
    v_operation := coalesce(v_payload->>'operation','observe');
    IF v_operation NOT IN ('observe','action') THEN
      RAISE EXCEPTION 'computer.use.android operation unsupported';
    END IF;

    IF v_operation = 'action' OR v_payload ? 'action' THEN
      IF NOT (v_payload ? 'action') OR jsonb_typeof(v_payload->'action') <> 'object' THEN
        RAISE EXCEPTION 'computer.use.android action required';
      END IF;

      v_action := v_payload->'action';
      FOR v_key IN SELECT jsonb_object_keys(v_action) LOOP
        IF v_key NOT IN ('action','nodeId','text','keyCode','direction','url','ms','x1','y1','x2','y2','durationMs') THEN
          RAISE EXCEPTION 'computer.use.android action field unsupported';
        END IF;
      END LOOP;

      IF NOT (v_action ? 'action') OR jsonb_typeof(v_action->'action') <> 'string' THEN
        RAISE EXCEPTION 'computer.use.android action name required';
      END IF;

      v_action_name := v_action->>'action';
      IF v_action_name NOT IN ('click','type','press','scroll','navigate','launch_app','wait','swipe') THEN
        RAISE EXCEPTION 'computer.use.android action unsupported';
      END IF;

      IF v_action_name IN ('click','type','scroll') AND (
        NOT (v_action ? 'nodeId')
        OR jsonb_typeof(v_action->'nodeId') <> 'string'
        OR length(trim(v_action->>'nodeId')) = 0
      ) THEN RAISE EXCEPTION 'computer.use.android nodeId required'; END IF;

      IF v_action_name = 'type' THEN
        IF v_payload ? 'secret_ref' THEN
          IF v_action ? 'text' THEN
            RAISE EXCEPTION 'computer.use.android secret_ref forbids inline text';
          END IF;
        ELSIF NOT (v_action ? 'text')
           OR jsonb_typeof(v_action->'text') <> 'string'
           OR length(v_action->>'text') = 0
           OR length(v_action->>'text') > 32768 THEN
          RAISE EXCEPTION 'computer.use.android type text invalid';
        END IF;
      END IF;

      IF v_action_name = 'press' AND (
        NOT (v_action ? 'keyCode')
        OR jsonb_typeof(v_action->'keyCode') <> 'number'
        OR (v_action->>'keyCode')::numeric <> trunc((v_action->>'keyCode')::numeric)
        OR (v_action->>'keyCode')::numeric < 0
        OR (v_action->>'keyCode')::numeric > 1000
      ) THEN RAISE EXCEPTION 'computer.use.android keyCode invalid'; END IF;

      IF v_action_name = 'scroll' AND (
        NOT (v_action ? 'direction')
        OR v_action->>'direction' NOT IN ('forward','backward')
      ) THEN RAISE EXCEPTION 'computer.use.android direction invalid'; END IF;

      IF v_action_name = 'navigate' AND (
        NOT (v_action ? 'url')
        OR jsonb_typeof(v_action->'url') <> 'string'
        OR length(trim(v_action->>'url')) = 0
        OR length(v_action->>'url') > 2048
      ) THEN RAISE EXCEPTION 'computer.use.android url invalid'; END IF;

      IF v_action_name = 'launch_app' AND (
        NOT (v_payload ? 'target_package')
        OR length(trim(v_payload->>'target_package')) = 0
      ) THEN RAISE EXCEPTION 'computer.use.android launch_app target_package required'; END IF;

      IF v_action_name = 'wait' AND (
        NOT (v_action ? 'ms')
        OR jsonb_typeof(v_action->'ms') <> 'number'
        OR (v_action->>'ms')::numeric <> trunc((v_action->>'ms')::numeric)
        OR (v_action->>'ms')::numeric < 0
        OR (v_action->>'ms')::numeric > 5000
      ) THEN RAISE EXCEPTION 'computer.use.android wait ms invalid'; END IF;

      IF v_action_name = 'swipe' AND (
        NOT (v_action ? 'x1') OR jsonb_typeof(v_action->'x1') <> 'number'
        OR NOT (v_action ? 'y1') OR jsonb_typeof(v_action->'y1') <> 'number'
        OR NOT (v_action ? 'x2') OR jsonb_typeof(v_action->'x2') <> 'number'
        OR NOT (v_action ? 'y2') OR jsonb_typeof(v_action->'y2') <> 'number'
        OR NOT (v_action ? 'durationMs') OR jsonb_typeof(v_action->'durationMs') <> 'number'
        OR (v_action->>'durationMs')::numeric <> trunc((v_action->>'durationMs')::numeric)
        OR (v_action->>'durationMs')::numeric < 80
        OR (v_action->>'durationMs')::numeric > 3000
        OR (v_action->>'x1')::numeric < 0 OR (v_action->>'x1')::numeric > 20000
        OR (v_action->>'y1')::numeric < 0 OR (v_action->>'y1')::numeric > 20000
        OR (v_action->>'x2')::numeric < 0 OR (v_action->>'x2')::numeric > 20000
        OR (v_action->>'y2')::numeric < 0 OR (v_action->>'y2')::numeric > 20000
      ) THEN RAISE EXCEPTION 'computer.use.android swipe payload invalid'; END IF;

      IF v_action_name = 'swipe' AND (
        abs((v_action->>'x2')::numeric - (v_action->>'x1')::numeric) < 8
        AND abs((v_action->>'y2')::numeric - (v_action->>'y1')::numeric) < 8
      ) THEN RAISE EXCEPTION 'computer.use.android swipe distance too small'; END IF;

      IF v_payload ? 'secret_ref' AND v_action_name <> 'type' THEN
        RAISE EXCEPTION 'computer.use.android secret_ref requires type action';
      END IF;
    END IF;
  END IF;

  SELECT status INTO v_device_status
  FROM aria_internal.device_registry
  WHERE device_id = trim(p_device_id);

  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_registered'; END IF;
  IF v_device_status = 'disabled' THEN RAISE EXCEPTION 'device_disabled'; END IF;

  INSERT INTO aria_internal.execution_jobs(
    job_id, mission_id, device_id, operation, command, cwd, timeout_ms,
    policy, status, metadata
  )
  VALUES(
    trim(p_job_id), p_mission_id, p_device_id, 'computer.use.android',
    p_command, p_cwd, p_timeout_ms, coalesce(p_policy,'{}'::jsonb),
    'queued', coalesce(p_metadata,'{}'::jsonb)
  )
  ON CONFLICT (job_id) DO NOTHING;

  SELECT to_jsonb(x) INTO r
  FROM aria_internal.execution_jobs x
  WHERE x.job_id = trim(p_job_id);

  RETURN r;
END;
$$;


