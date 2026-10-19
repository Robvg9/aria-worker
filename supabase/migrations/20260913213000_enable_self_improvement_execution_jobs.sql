create or replace function public.enqueue_execution_job_gateway(
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
set search_path to pg_catalog, aria_internal
as $$
declare
  r jsonb;
  v_payload jsonb;
  v_key text;
  v_category text;
  v_risk text;
begin
  if p_job_id is null or length(trim(p_job_id)) < 8 then raise exception 'invalid job id'; end if;
  if p_mission_id is null or length(trim(p_mission_id)) < 1 then raise exception 'mission id required'; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then raise exception 'device id required'; end if;
  if p_operation not in ('shell.execute','ollama.qwen3','computer.use','self.improve') then raise exception 'unsupported operation'; end if;
  if p_command is null or length(trim(p_command)) = 0 then raise exception 'command required'; end if;
  if p_timeout_ms is null or p_timeout_ms < 1000 or p_timeout_ms > 3600000 then raise exception 'invalid timeout'; end if;

  if p_operation in ('ollama.qwen3','computer.use','self.improve') then
    begin v_payload := p_command::jsonb; exception when others then raise exception '% payload must be valid JSON', p_operation; end;
    if jsonb_typeof(v_payload) <> 'object' then raise exception '% payload must be an object', p_operation; end if;
  end if;

  if p_operation = 'self.improve' then
    for v_key in select jsonb_object_keys(v_payload) loop
      if v_key not in ('goal','category','risk','scope','proposed_changes','mission_id','step_id','device_id') then
        raise exception 'self.improve payload contains unsupported fields';
      end if;
    end loop;
    if not (v_payload ? 'goal') or jsonb_typeof(v_payload->'goal') <> 'string' or length(trim(v_payload->>'goal')) = 0 or length(v_payload->>'goal') > 1000 then raise exception 'self.improve goal required'; end if;
    v_category := coalesce(v_payload->>'category','capability_gap');
    if v_category not in ('reliability','performance','documentation','observability','capability_gap','regression') then raise exception 'self.improve category not autonomous'; end if;
    v_risk := upper(coalesce(v_payload->>'risk','LOW'));
    if v_risk <> 'LOW' then raise exception 'self.improve risk not autonomous'; end if;
    if coalesce(v_payload->>'mission_id','') <> trim(p_mission_id) then raise exception 'self.improve mission mismatch'; end if;
    if coalesce(v_payload->>'device_id','') <> trim(p_device_id) then raise exception 'self.improve device mismatch'; end if;
    if jsonb_typeof(v_payload->'scope') <> 'array' then raise exception 'self.improve scope required'; end if;
    if jsonb_typeof(v_payload->'proposed_changes') <> 'array' then raise exception 'self.improve proposed_changes required'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_payload->'proposed_changes') x
      where jsonb_typeof(x) <> 'object' or upper(coalesce(x->>'risk_level','LOW')) <> 'LOW'
    ) then raise exception 'self.improve change risk not autonomous'; end if;
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
    for v_key in select jsonb_object_keys(v_payload) loop
      if v_key not in ('action','x','y','x1','y1','x2','y2','button','text','key','keys','delta','path','process','ms','duration_ms') then raise exception 'computer.use payload contains unsupported fields'; end if;
    end loop;
    if not (v_payload ? 'action') or jsonb_typeof(v_payload->'action') <> 'string' then raise exception 'computer.use action required'; end if;
  end if;

  insert into aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,status,metadata)
  values(p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,coalesce(p_policy,'{}'::jsonb),'queued',coalesce(p_metadata,'{}'::jsonb))
  on conflict(job_id) do nothing;
  select to_jsonb(x) into r from aria_internal.execution_jobs x where x.job_id=p_job_id;
  return r;
end;
$$;
