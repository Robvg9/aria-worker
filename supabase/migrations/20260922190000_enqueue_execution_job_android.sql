-- Align the canonical execution-job enqueue contract with the physical Android UI agent.
-- The Android runtime uses operation=computer.use.android over authenticated loopback IPC.
create or replace function aria_internal.enqueue_execution_job(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
  p_operation text,
  p_command text,
  p_cwd text default null,
  p_timeout_ms integer default 120000,
  p_policy jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to aria_internal, pg_catalog
as $function$
declare
  r jsonb;
  v_payload jsonb;
  v_key text;
  v_action jsonb;
  v_action_name text;
  v_button text;
  v_arr_len integer;
  v_device_status text;
  v_operation text;
begin
  if p_job_id is null or length(trim(p_job_id)) < 8 then raise exception 'invalid job id'; end if;
  if p_mission_id is null or length(trim(p_mission_id)) < 1 then raise exception 'mission id required'; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then raise exception 'device id required'; end if;
  if p_operation not in ('shell.execute','ollama.qwen3','computer.use','computer.use.android') then raise exception 'unsupported operation'; end if;
  if p_command is null or length(trim(p_command)) = 0 then raise exception 'command required'; end if;
  if p_timeout_ms is null or p_timeout_ms < 1000 or p_timeout_ms > 3600000 then raise exception 'invalid timeout'; end if;

  if p_operation in ('ollama.qwen3','computer.use','computer.use.android') then
    begin
      v_payload := p_command::jsonb;
    exception when others then
      raise exception '% payload must be valid JSON', p_operation;
    end;
    if jsonb_typeof(v_payload) <> 'object' then raise exception '% payload must be an object', p_operation; end if;
  end if;

  if p_operation = 'ollama.qwen3' then
    for v_key in select jsonb_object_keys(v_payload) loop
      if v_key not in ('prompt','model','timeout_ms') then raise exception 'ollama.qwen3 payload contains unsupported fields'; end if;
    end loop;
    if not (v_payload ? 'prompt') or jsonb_typeof(v_payload->'prompt') <> 'string' or length(trim(v_payload->>'prompt')) = 0 then raise exception 'ollama.qwen3 prompt required'; end if;
    if v_payload ? 'model' and v_payload->>'model' <> 'qwen3:4b' then raise exception 'ollama.qwen3 model must be qwen3:4b'; end if;
    if p_cwd is not null then raise exception 'ollama.qwen3 does not accept cwd'; end if;
  end if;

  if p_operation = 'computer.use' then
    if not (v_payload ? 'action') or jsonb_typeof(v_payload->'action') <> 'string' then raise exception 'computer.use action required'; end if;
    v_operation := v_payload->>'action';
    if v_operation not in ('screenshot','observe','open','click','double_click','move','drag','type','keypress','hotkey','scroll','focus','wait') then raise exception 'computer.use action unsupported'; end if;
  end if;

  if p_operation = 'computer.use.android' then
    for v_key in select jsonb_object_keys(v_payload) loop
      if v_key not in ('operation','action','target_package','allow_any_app','allowed_hosts','secret_ref','mode','goal','history','observation','mission_id','request_id') then
        raise exception 'computer.use.android payload contains unsupported fields';
      end if;
    end loop;
    if v_payload ? 'target_package' and (jsonb_typeof(v_payload->'target_package') <> 'string' or length(trim(v_payload->>'target_package')) > 200) then
      raise exception 'computer.use.android target_package invalid';
    end if;
    if v_payload ? 'allow_any_app' and jsonb_typeof(v_payload->'allow_any_app') <> 'boolean' then
      raise exception 'computer.use.android allow_any_app invalid';
    end if;
    if v_payload ? 'allowed_hosts' then
      if jsonb_typeof(v_payload->'allowed_hosts') <> 'array' or jsonb_array_length(v_payload->'allowed_hosts') > 20 then
        raise exception 'computer.use.android allowed_hosts invalid';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_payload->'allowed_hosts') h
        where jsonb_typeof(h) <> 'string' or length(trim(h #>> '{}')) = 0 or length(trim(h #>> '{}')) > 255
      ) then
        raise exception 'computer.use.android allowed_hosts invalid';
      end if;
    end if;
    if v_payload ? 'secret_ref' and (
      jsonb_typeof(v_payload->'secret_ref') <> 'string'
      or not (v_payload->>'secret_ref' ~ '^secret://rwht/[A-Za-z0-9._:-]+$')
    ) then
      raise exception 'computer.use.android secret_ref invalid';
    end if;
    if v_payload ? 'mode' and (jsonb_typeof(v_payload->'mode') <> 'string' or length(trim(v_payload->>'mode')) > 64) then
      raise exception 'computer.use.android mode invalid';
    end if;
    if v_payload ? 'goal' and (jsonb_typeof(v_payload->'goal') <> 'string' or length(v_payload->>'goal') > 4096) then
      raise exception 'computer.use.android goal invalid';
    end if;

    if coalesce(v_payload->>'mode','') = 'autonomous_test' then
      if not (v_payload ? 'goal') or length(trim(v_payload->>'goal')) = 0 then
        raise exception 'computer.use.android autonomous goal required';
      end if;
    else
      v_operation := coalesce(v_payload->>'operation','observe');
      if v_operation not in ('observe','action') then raise exception 'computer.use.android operation unsupported'; end if;
      if v_operation = 'action' or v_payload ? 'action' then
        if not (v_payload ? 'action') or jsonb_typeof(v_payload->'action') <> 'object' then
          raise exception 'computer.use.android action required';
        end if;
        v_action := v_payload->'action';
        for v_key in select jsonb_object_keys(v_action) loop
          if v_key not in ('action','nodeId','text','keyCode','direction','url','ms') then
            raise exception 'computer.use.android action field unsupported';
          end if;
        end loop;
        if not (v_action ? 'action') or jsonb_typeof(v_action->'action') <> 'string' then
          raise exception 'computer.use.android action name required';
        end if;
        v_action_name := v_action->>'action';
        if v_action_name not in ('click','type','press','scroll','navigate','launch_app','wait') then
          raise exception 'computer.use.android action unsupported';
        end if;
        if v_action_name in ('click','type','scroll') and (
          not (v_action ? 'nodeId') or jsonb_typeof(v_action->'nodeId') <> 'string'
          or length(trim(v_action->>'nodeId')) = 0
        ) then
          raise exception 'computer.use.android nodeId required';
        end if;
        if v_action_name = 'type' then
          if v_payload ? 'secret_ref' then
            if v_action ? 'text' then raise exception 'computer.use.android secret_ref forbids inline text'; end if;
          elsif not (v_action ? 'text')
            or jsonb_typeof(v_action->'text') <> 'string'
            or length(v_action->>'text') = 0
            or length(v_action->>'text') > 32768 then
            raise exception 'computer.use.android type text invalid';
          end if;
        end if;
        if v_action_name = 'press' and (
          not (v_action ? 'keyCode')
          or jsonb_typeof(v_action->'keyCode') <> 'number'
          or (v_action->>'keyCode')::numeric <> trunc((v_action->>'keyCode')::numeric)
          or (v_action->>'keyCode')::numeric < 0
          or (v_action->>'keyCode')::numeric > 1000
        ) then
          raise exception 'computer.use.android keyCode invalid';
        end if;
        if v_action_name = 'scroll' and (
          not (v_action ? 'direction') or v_action->>'direction' not in ('forward','backward')
        ) then
          raise exception 'computer.use.android direction invalid';
        end if;
        if v_action_name = 'navigate' and (
          not (v_action ? 'url') or jsonb_typeof(v_action->'url') <> 'string'
          or length(trim(v_action->>'url')) = 0 or length(v_action->>'url') > 2048
        ) then
          raise exception 'computer.use.android url invalid';
        end if;
        if v_action_name = 'launch_app' and (
          not (v_payload ? 'target_package') or length(trim(v_payload->>'target_package')) = 0
        ) then
          raise exception 'computer.use.android launch_app target_package required';
        end if;
        if v_action_name = 'wait' and (
          not (v_action ? 'ms') or jsonb_typeof(v_action->'ms') <> 'number'
          or (v_action->>'ms')::numeric <> trunc((v_action->>'ms')::numeric)
          or (v_action->>'ms')::numeric < 0 or (v_action->>'ms')::numeric > 5000
        ) then
          raise exception 'computer.use.android wait ms invalid';
        end if;
        if v_payload ? 'secret_ref' and v_action_name <> 'type' then
          raise exception 'computer.use.android secret_ref requires type action';
        end if;
      end if;
    end if;
  end if;

  select status into v_device_status
    from aria_internal.device_registry
   where device_id = trim(p_device_id);
  if not found then raise exception 'device_not_registered'; end if;
  if v_device_status = 'disabled' then raise exception 'device_disabled'; end if;

  insert into aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,status,metadata)
  values(p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,coalesce(p_policy,'{}'::jsonb),'queued',coalesce(p_metadata,'{}'::jsonb))
  on conflict (job_id) do nothing;

  select to_jsonb(x) into r from aria_internal.execution_jobs x where x.job_id=p_job_id;
  return r;
end;
$function$;
