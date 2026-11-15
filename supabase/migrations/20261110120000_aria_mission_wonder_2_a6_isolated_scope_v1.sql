-- Bind A6 scope identities to the canonical mission runner's job ID and goal hash.
-- Fail closed during arming instead of allowing an invalid scope to reach canonical runtime.
begin;

create or replace function aria_internal.aria_m22_a6_arm_run_v1(
  p_run_id text,
  p_owner_user_id text,
  p_parent_request_id text,
  p_human_gate_ref text,
  p_heartbeat_interval_ms integer,
  p_max_normal_heartbeat_gap_ms integer,
  p_scopes jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  item jsonb;
  ordinal integer;
  expected_offset integer;
  expected_mission text;
  expected_scope text;
  expected_request text;
  expected_path text;
  expected_goal text;
  expected_step text;
  expected_goal_hash text;
  expected_job_id text;
  goal_identity_payload text;
  run_row aria_internal.mission_wonder_2_a6_runs;
  inserted_count integer := 0;
  ambient jsonb;
begin
  if coalesce(p_run_id,'') !~ '^m22-a6-[a-f0-9]{12}$'
     or nullif(btrim(p_owner_user_id),'') is null
     or nullif(btrim(p_parent_request_id),'') is null
     or length(p_parent_request_id)>200
     or coalesce(p_human_gate_ref,'') !~ '^a6-human-gate-[0-9]{10,20}[.][0-9]{1,3}$'
     or p_heartbeat_interval_ms not between 1000 and 180000
     or p_max_normal_heartbeat_gap_ms < p_heartbeat_interval_ms
     or p_max_normal_heartbeat_gap_ms > p_heartbeat_interval_ms*3
     or jsonb_typeof(p_scopes) is distinct from 'array'
     or jsonb_array_length(p_scopes) <> 5 then
    raise exception 'a6_run_spec_invalid';
  end if;

  if exists(select 1 from aria_internal.mission_wonder_2_a6_runs where status='running') then
    raise exception 'a6_another_run_is_active';
  end if;
  ambient := aria_internal.aria_m22_a6_ambient_snapshot_v1();
  if (ambient->>'cron48Active')::boolean or (ambient->>'cron49Active')::boolean or
     (ambient->>'cron50Active')::boolean or (ambient->>'nonA6ActiveJobCount')::integer<>0 then
    raise exception 'a6_ambient_baseline_not_safe';
  end if;

  insert into aria_internal.mission_wonder_2_a6_runs (
    run_id,scope_id,owner_user_id,parent_request_id,allowed_device_id,status,
    window_hours,max_missions,max_jobs,max_attempts,heartbeat_interval_ms,
    max_normal_heartbeat_gap_ms,max_recovery_ms,max_p95_latency_ms,
    max_total_cost_usd,minimum_mission_span_ms,max_mission_intermission_ms,
    human_gate_ref,ambient_baseline,expires_at
  ) values (
    p_run_id,
    'mission_wonder_2_a6_run_'||p_run_id,
    btrim(p_owner_user_id),
    btrim(p_parent_request_id),
    'windows-fe722cc6681e4f9c9cc35f5ebbb0a089',
    'armed',24,5,5,1,p_heartbeat_interval_ms,
    p_max_normal_heartbeat_gap_ms,120000,90000,0,64800000,25200000,p_human_gate_ref,ambient,
    clock_timestamp()+interval '25 hours'
  ) returning * into run_row;

  for item in select value from jsonb_array_elements(p_scopes) loop
    ordinal := (item->>'ordinal')::integer;
    expected_offset := case ordinal when 1 then 1 when 2 then 6 when 3 then 12 when 4 then 18 when 5 then 23 else null end;
    expected_mission := 'mission_'||replace(p_run_id,'-','_')||'_'||lpad(ordinal::text,2,'0');
    expected_scope := 'mission_wonder_2_a6_'||p_run_id||'_'||lpad(ordinal::text,2,'0');
    expected_request := p_run_id||'.'||ordinal::text;
    expected_path := 'C:\Windows\Temp\ARIA-MW2-A6\'||p_run_id||'\mission-'||lpad(ordinal::text,2,'0')||'\proof-'||lpad(ordinal::text,2,'0')||'.txt';
    expected_goal := 'Mission Wonder 2 A6 bounded continuity marker '||p_run_id||
      ' sequence '||lpad(ordinal::text,2,'0');
    expected_step := 'a6_continuity_marker_'||lpad(ordinal::text,2,'0');
    goal_identity_payload := '{"version":1,"user_id":'||to_json(btrim(p_owner_user_id))::text||
      ',"goal":'||to_json(expected_goal)::text||',"project_id":null}';
    expected_goal_hash := encode(extensions.digest(convert_to(goal_identity_payload,'UTF8'),'sha256'),'hex');
    expected_job_id := 'uo_'||left(expected_mission,28)||'_'||left(expected_step,28)||'_a1_'||
      substr(encode(extensions.digest(convert_to(
        expected_mission||chr(92)||'0'||expected_step||chr(92)||'0'||'1','UTF8'
      ),'sha256'),'hex'),1,16);

    if ordinal not between 1 and 5
       or item->>'mission_id' is distinct from expected_mission
       or item->>'scope_id' is distinct from expected_scope
       or item->>'request_id' is distinct from expected_request
       or item->>'allowed_device_id' is distinct from 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
       or item->>'operation' is distinct from 'shell.execute'
       or item->>'scheduled_offset_hours' is distinct from expected_offset::text
       or item->>'artifact_path' is distinct from expected_path
       or item->>'goal_hash' is distinct from expected_goal_hash
       or item->>'job_id' is distinct from expected_job_id
       or length(coalesce(item->>'command','')) not between 100 and 12000
       or position(expected_path in coalesce(item->>'command',''))=0
       or position('A6_ARTIFACT_VERIFIED' in coalesce(item->>'command',''))=0
       or position('ARIA_MW2_A6_CONTINUITY_V1|'||p_run_id||'|'||lpad(ordinal::text,2,'0') in coalesce(item->>'command',''))=0 then
      raise exception 'a6_scope_spec_invalid_ordinal_%', ordinal;
    end if;

    insert into aria_internal.mission_wonder_2_a6_scopes (
      scope_id,run_id,mission_id,job_id,owner_user_id,request_id,goal_hash,
      allowed_device_id,operation,command,artifact_path,ordinal,
      scheduled_offset_hours,status,expires_at
    ) values (
      expected_scope,p_run_id,expected_mission,item->>'job_id',btrim(p_owner_user_id),
      expected_request,item->>'goal_hash','windows-fe722cc6681e4f9c9cc35f5ebbb0a089',
      'shell.execute',item->>'command',expected_path,ordinal,expected_offset,'armed',
      clock_timestamp()+interval '25 hours'
    );
    inserted_count := inserted_count+1;
  end loop;

  if inserted_count <> 5 then raise exception 'a6_scope_count_not_five'; end if;
  return jsonb_build_object(
    'status','armed','run_id',run_row.run_id,'scope_id',run_row.scope_id,
    'scope_count',inserted_count,'max_missions',5,'max_jobs',5,
    'window_hours',24,'minimum_mission_span_ms',64800000,
    'max_mission_intermission_ms',25200000,'human_gate_ref',run_row.human_gate_ref
  );
end;
$function$;

commit;
