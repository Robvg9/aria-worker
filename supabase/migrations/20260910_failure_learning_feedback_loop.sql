-- Applied to production on 2026-09-10. Keeps failure evidence in cognitive memory and makes the skill-learning cron gate on actual skills, not generic mission_learning rows.

create or replace function aria_memory.capture_mission_outcome()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_content text;
  v_hash text;
  v_id uuid;
  v_entity uuid;
  v_failure_detail text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.status not in ('succeeded','failed','cancelled') or new.status = old.status then return new; end if;
  v_entity := aria_memory.upsert_world_entity('mission',new.mission_id,'inactive',jsonb_build_object('goal',new.goal,'mission_status',new.status,'completed_steps',new.completed_steps,'total_steps',new.total_steps,'recovery_count',new.recovery_count,'current_agent_id',new.current_agent_id),case when new.status='succeeded' then 1 else .85 end,new.mission_id,jsonb_build_object('capture','mission_state_trigger'));
  v_failure_detail := CASE WHEN new.status='failed' THEN regexp_replace(left(coalesce(new.last_stderr,''),1200),'(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+|((?:api[_ -]?key|token|secret|password)[^:=]{0,30}[:=]\s*)[^,;\n]+','\\1[REDACTED]\\2[REDACTED]','g') ELSE '' END;
  v_content := 'Mission '||new.mission_id||' finished with status='||new.status||'. Goal='||coalesce(new.goal,'')||'. Completed steps='||coalesce(new.completed_steps,0)::text||'/'||coalesce(new.total_steps,0)::text||'. Exit code='||coalesce(new.last_exit_code::text,'null')||'. Next action='||coalesce(new.next_action,'')||'.';
  if v_failure_detail <> '' then v_content := v_content || ' Failure detail=' || v_failure_detail || '.'; end if;
  v_hash := encode(extensions.digest(v_content,'sha256'),'hex');
  insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience)
  values('episodic','Mission outcome '||new.mission_id,v_content,v_hash,'mission',new.mission_id,jsonb_build_object('capture','mission_state_trigger','status',new.status,'mission_id',new.mission_id),jsonb_build_object('goal',new.goal,'status',new.status,'completed_steps',new.completed_steps,'total_steps',new.total_steps,'recovery_count',new.recovery_count,'exit_code',new.last_exit_code,'failure_detail',case when v_failure_detail<>'' then v_failure_detail else null end,'world_entity_id',v_entity),case when new.status='succeeded' then 1 else .85 end,.8,.9)
  on conflict(content_hash) do update set updated_at=now()
  returning memory_id into v_id;
  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload) values(v_id,'created',new.mission_id,jsonb_build_object('trigger','mission_state','status',new.status,'world_entity_id',v_entity));
  perform aria_memory.reflect_mission_outcome(v_id,new.mission_id,new.status,new.goal,new.completed_steps,new.total_steps,new.recovery_count);
  return new;
end;
$$;

create or replace function aria_memory.reflect_mission_outcome(p_memory_id uuid,p_mission_id text,p_status text,p_goal text,p_completed_steps integer,p_total_steps integer,p_recovery_count integer)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_content text;
  v_hash text;
  v_lesson uuid;
  v_confidence numeric;
  v_detail text;
begin
  select left(coalesce(m.content,''),1800) into v_detail from aria_memory.memory_items m where m.memory_id=p_memory_id;
  if p_status='succeeded' then
    v_content := 'Reflection: mission '||p_mission_id||' succeeded. Reusable pattern candidate: complete '||coalesce(p_completed_steps,0)::text||' of '||coalesce(p_total_steps,0)::text||' steps for goal '||coalesce(p_goal,'')||'. Recovery count='||coalesce(p_recovery_count,0)::text||'.';
    v_confidence := .95;
  elsif p_status='failed' then
    v_content := 'Reflection: mission '||p_mission_id||' failed. Failure pattern candidate for future planning. Goal='||coalesce(p_goal,'')||'. Completed '||coalesce(p_completed_steps,0)::text||' of '||coalesce(p_total_steps,0)::text||'. Recovery count='||coalesce(p_recovery_count,0)::text||'. Known failure evidence='||v_detail||'.';
    v_confidence := .85;
  else
    v_content := 'Reflection: mission '||p_mission_id||' ended with status='||p_status||'. Treat as contextual experience, not a verified success.';
    v_confidence := .70;
  end if;
  v_hash := encode(extensions.digest(v_content,'sha256'),'hex');
  insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience)
  values('lesson','Reflection for mission '||p_mission_id,v_content,v_hash,'mission',p_mission_id,jsonb_build_object('engine','reflection-v2','derived_from_memory_id',p_memory_id,'status',p_status),jsonb_build_object('mission_id',p_mission_id,'status',p_status,'completed_steps',p_completed_steps,'total_steps',p_total_steps,'recovery_count',p_recovery_count,'goal',coalesce(p_goal,''),'reusable_candidate',p_status='succeeded','failure_pattern',p_status='failed'),v_confidence,case when p_status='succeeded' then .9 else .8 end,.9)
  on conflict(content_hash) do update set updated_at=now()
  returning memory_id into v_lesson;
  insert into aria_memory.memory_relations(from_memory_id,to_memory_id,relation_type,strength,provenance) values(v_lesson,p_memory_id,'derived_from',v_confidence,jsonb_build_object('engine','reflection-v2')) on conflict(from_memory_id,to_memory_id,relation_type) do nothing;
  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload) values(v_lesson,'created',p_mission_id,jsonb_build_object('reflection','v2','source_memory_id',p_memory_id,'status',p_status));
  if p_status='succeeded' then perform aria_memory.compile_skill_for_goal(coalesce(p_goal,'')); end if;
  return v_lesson;
end;
$$;

select cron.alter_job(
  29::bigint,
  '* * * * *'::text,
  $$select net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-learning-v3',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-ARIA-AUTONOMY-TOKEN',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1)
    ),
    body := jsonb_build_object('mission_id', candidate.mission_id),
    timeout_milliseconds := 15000
  )
  from (
    select ms.mission_id
    from aria_internal.mission_state ms
    where ms.status='succeeded'
      and ms.updated_at > now() - interval '24 hours'
      and not exists (
        select 1
        from aria_memory.memory_items mi
        where mi.memory_type='skill'
          and mi.source_type='mission'
          and mi.source_ref=ms.mission_id
      )
    order by ms.updated_at asc, ms.mission_id asc
    limit 1
  ) candidate$$::text,
  NULL::text,
  NULL::text,
  true
);