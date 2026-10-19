-- Self-Improvement retry semantics v1
-- Failed/timeout/cancelled execution jobs must not be reused as the next attempt.
-- A deterministic base job remains the idempotency anchor; retries become child attempts.

create or replace function aria_internal.get_execution_job(p_job_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'aria_internal','pg_catalog'
as $function$
declare
  r jsonb;
  exact_status text;
  latest jsonb;
begin
  if p_job_id is null or btrim(p_job_id)='' then return null; end if;
  select to_jsonb(x), x.status into r, exact_status
  from aria_internal.execution_jobs x
  where x.job_id=p_job_id;
  if r is null then
    select to_jsonb(x) into latest
    from aria_internal.execution_jobs x
    where x.metadata->>'retry_of'=p_job_id
      and x.status not in ('failed','timeout','cancelled')
    order by coalesce((x.metadata->>'attempt')::integer,0) desc, x.requested_at desc, x.job_id desc
    limit 1;
    return latest;
  end if;
  if exact_status not in ('failed','timeout','cancelled') then return r; end if;
  select to_jsonb(x) into latest
  from aria_internal.execution_jobs x
  where x.metadata->>'retry_of'=p_job_id
    and x.status not in ('failed','timeout','cancelled')
  order by coalesce((x.metadata->>'attempt')::integer,0) desc, x.requested_at desc, x.job_id desc
  limit 1;
  return latest;
end;
$function$;

create or replace function public.get_execution_job_gateway(p_job_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
begin
  return aria_internal.get_execution_job(p_job_id);
end;
$function$;

create or replace function public.enqueue_execution_job_gateway(
  p_job_id text,p_mission_id text,p_device_id text,p_operation text,p_command text,
  p_cwd text default null,p_timeout_ms integer default 120000,
  p_policy jsonb default '{}'::jsonb,p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r jsonb; existing aria_internal.execution_jobs; child aria_internal.execution_jobs;
  v_payload jsonb; v_key text; v_action text; v_button text; v_arr_len integer;
  v_category text; v_risk text; v_attempt integer; v_child_id text; v_child_metadata jsonb;
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
      if v_key not in ('goal','category','risk','scope','proposed_changes','mission_id','step_id','device_id') then raise exception 'self.improve payload contains unsupported fields'; end if;
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
    if exists (select 1 from jsonb_array_elements(v_payload->'proposed_changes') x where jsonb_typeof(x) <> 'object' or upper(coalesce(x->>'risk_level','LOW')) <> 'LOW') then raise exception 'self.improve change risk not autonomous'; end if;
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
    v_action := v_payload->>'action';
    if v_action not in ('screenshot','observe','open','click','double_click','move','drag','type','keypress','hotkey','scroll','focus','wait') then raise exception 'computer.use action unsupported'; end if;
    if v_action = 'type' and (not (v_payload ? 'text') or jsonb_typeof(v_payload->'text') <> 'string' or length(v_payload->>'text')=0 or length(v_payload->>'text')>32768) then raise exception 'computer.use type text invalid'; end if;
    if v_action = 'keypress' and (not (v_payload ? 'key') or jsonb_typeof(v_payload->'key') <> 'string' or length(trim(v_payload->>'key'))=0) then raise exception 'computer.use key invalid'; end if;
    if v_action = 'hotkey' and (not (v_payload ? 'keys') or jsonb_typeof(v_payload->'keys') <> 'array' or jsonb_array_length(v_payload->'keys')<2 or jsonb_array_length(v_payload->'keys')>6) then raise exception 'computer.use hotkey invalid'; end if;
    if v_action = 'open' and (not (v_payload ? 'path') or jsonb_typeof(v_payload->'path') <> 'string' or length(trim(v_payload->>'path'))=0) then raise exception 'computer.use open path invalid'; end if;
    if v_payload ? 'button' then
      if jsonb_typeof(v_payload->'button') <> 'string' then raise exception 'computer.use button unsupported'; end if;
      v_button := lower(v_payload->>'button'); if v_button not in ('left','right') then raise exception 'computer.use button unsupported'; end if;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(trim(p_job_id), 0));
  select * into existing from aria_internal.execution_jobs where job_id=trim(p_job_id) for update;
  if found and existing.status not in ('failed','timeout','cancelled') then return to_jsonb(existing); end if;
  select * into child from aria_internal.execution_jobs where metadata->>'retry_of'=trim(p_job_id)
    order by coalesce((metadata->>'attempt')::integer,0) desc, requested_at desc, job_id desc limit 1 for update;
  if found and child.status not in ('failed','timeout','cancelled') then return to_jsonb(child); end if;
  if not found and existing.status is null then
    insert into aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,status,metadata,idempotency_key)
    values(trim(p_job_id),p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,coalesce(p_policy,'{}'::jsonb),'queued',coalesce(p_metadata,'{}'::jsonb),trim(p_job_id))
    returning to_jsonb(execution_jobs.*) into r; return r;
  end if;
  v_attempt := coalesce((child.metadata->>'attempt')::integer,0)+1; if v_attempt<1 then v_attempt:=1; end if;
  v_child_id := trim(p_job_id)||'__attempt_'||v_attempt::text;
  v_child_metadata := coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('retry_of',trim(p_job_id),'attempt',v_attempt,'retry_semantics','new_attempt');
  insert into aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,status,metadata,idempotency_key)
  values(v_child_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,coalesce(p_policy,'{}'::jsonb),'queued',v_child_metadata,v_child_id)
  on conflict(job_id) do nothing;
  select to_jsonb(x) into r from aria_internal.execution_jobs x where x.job_id=v_child_id; return r;
end;
$function$;