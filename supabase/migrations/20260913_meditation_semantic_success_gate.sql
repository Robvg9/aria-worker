create or replace function public.aria_mission_update_lease(p_mission_id text, p_worker_id text, p_mission jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare r aria_internal.mission_state; v_source text; v_step jsonb; v_step_id text; v_result jsonb; v_verify jsonb; v_command text; v_token text;
begin
 if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
 if coalesce(btrim(p_worker_id),'')='' then raise exception 'worker_id_required'; end if;
 if coalesce(p_mission->>'status','')='succeeded' then
  v_source:=coalesce(p_mission->'metadata'->>'source',(select metadata->>'source' from aria_internal.mission_state where mission_id=p_mission_id));
  if v_source='meditation-ia-v1' then
   if jsonb_typeof(coalesce(p_mission->'checkpoint'->'plan','null'))<>'array' or jsonb_array_length(coalesce(p_mission->'checkpoint'->'plan','[]'::jsonb))=0 then raise exception 'semantic_verification_required:plan_missing'; end if;
   if jsonb_typeof(coalesce(p_mission->'checkpoint'->'results','null'))<>'object' then raise exception 'semantic_verification_required:results_missing'; end if;
   for v_step in select value from jsonb_array_elements(p_mission->'checkpoint'->'plan') loop
    v_step_id:=v_step->>'id'; if coalesce(v_step_id,'')='' then raise exception 'semantic_verification_required:step_id_missing'; end if;
    v_result:=p_mission->'checkpoint'->'results'->v_step_id;
    if v_result is null or jsonb_typeof(v_result)<>'object' then raise exception 'semantic_verification_required:result_missing:%',v_step_id; end if;
    if coalesce(v_result->>'status','')<>'succeeded' then raise exception 'semantic_verification_required:step_not_succeeded:%',v_step_id; end if;
    v_verify:=coalesce(v_step->'verify','{}'::jsonb);
    if jsonb_typeof(v_verify)<>'object' or v_verify='{}'::jsonb then raise exception 'semantic_verification_required:explicit_verifier_missing:%',v_step_id; end if;
    if v_verify ? 'expected_exit_code' and coalesce((v_result->>'exit_code')::integer,-2147483648)<>(v_verify->>'expected_exit_code')::integer then raise exception 'semantic_verification_failed:exit_code:%',v_step_id; end if;
    if v_verify ? 'stdout_contains' and position(v_verify->>'stdout_contains' in coalesce(v_result->>'stdout',''))=0 then raise exception 'semantic_verification_failed:stdout:%',v_step_id; end if;
    if v_verify ? 'stderr_contains' and position(v_verify->>'stderr_contains' in coalesce(v_result->>'stderr',''))=0 then raise exception 'semantic_verification_failed:stderr:%',v_step_id; end if;
    if v_verify ? 'response_content_equals' and coalesce(v_result->'response'->>'content',v_result->'response'->>'output_text','')<>(v_verify->>'response_content_equals') then raise exception 'semantic_verification_failed:response_equals:%',v_step_id; end if;
    if v_verify ? 'response_content_contains' and position(v_verify->>'response_content_contains' in coalesce(v_result->'response'->>'content',v_result->'response'->>'output_text',''))=0 then raise exception 'semantic_verification_failed:response_contains:%',v_step_id; end if;
    if lower(coalesce(v_step->>'operation',''))='shell.execute' and lower(coalesce(v_step->'target'->>'type',v_step->>'executor_type',''))='device' then
     v_command:=coalesce(v_step->'input'->>'command','');
     v_token:=(regexp_match(v_command,'ARIA_[A-Z0-9_]+'))[1];
     if coalesce(v_token,'')<>'' and position(v_token in coalesce(v_result->>'stdout',''))=0 then raise exception 'semantic_verification_failed:goal_token:%',v_step_id; end if;
    end if;
   end loop;
  end if;
 end if;
 update aria_internal.mission_state set goal=coalesce(p_mission->>'goal',goal),status=coalesce(p_mission->>'status',status),current_step=coalesce((p_mission->>'current_step')::integer,current_step),total_steps=case when p_mission ? 'total_steps' then case when p_mission->>'total_steps' is null then null else (p_mission->>'total_steps')::integer end else total_steps end,completed_steps=coalesce((p_mission->>'completed_steps')::integer,completed_steps),attempt_count=coalesce((p_mission->>'attempt_count')::integer,attempt_count),current_agent_id=case when p_mission ? 'current_agent_id' then p_mission->>'current_agent_id' else current_agent_id end,current_workspace=case when p_mission ? 'current_workspace' then p_mission->>'current_workspace' else current_workspace end,last_command=case when p_mission ? 'last_command' then p_mission->>'last_command' else last_command end,last_exit_code=case when p_mission ? 'last_exit_code' then case when p_mission->>'last_exit_code' is null then null else (p_mission->>'last_exit_code')::integer end else last_exit_code end,last_stdout=case when p_mission ? 'last_stdout' then p_mission->>'last_stdout' else last_stdout end,last_stderr=case when p_mission ? 'last_stderr' then p_mission->>'last_stderr' else last_stderr end,next_action=case when p_mission ? 'next_action' then p_mission->>'next_action' else next_action end,checkpoint=coalesce(p_mission->'checkpoint',checkpoint),metadata=coalesce(p_mission->'metadata',metadata),finished_at=case when p_mission ? 'finished_at' then case when p_mission->>'finished_at' is null then null else (p_mission->>'finished_at')::timestamptz end else finished_at end,lease_owner=case when p_mission ? 'lease_owner' then p_mission->>'lease_owner' else lease_owner end,lease_until=case when p_mission ? 'lease_until' then case when p_mission->>'lease_until' is null then null else (p_mission->>'lease_until')::timestamptz end else lease_until end,updated_at=clock_timestamp() where mission_id=p_mission_id and lease_owner=p_worker_id and lease_until is not null and lease_until>clock_timestamp() returning * into r;
 if not found then return null; end if; return to_jsonb(r);
end; $function$;