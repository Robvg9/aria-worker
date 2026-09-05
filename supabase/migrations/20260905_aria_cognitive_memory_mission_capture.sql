create or replace function aria_memory.capture_mission_outcome() returns trigger
language plpgsql security definer set search_path=''
as $$
declare v_content text; v_hash text; v_id uuid;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.status not in ('succeeded','failed','cancelled') or new.status = old.status then return new; end if;
  v_content := 'Mission '||new.mission_id||' finished with status='||new.status||'. Goal='||coalesce(new.goal,'')||'. Completed steps='||coalesce(new.completed_steps,0)::text||'/'||coalesce(new.total_steps,0)::text||'. Last command='||coalesce(new.last_command,'')||'. Exit code='||coalesce(new.last_exit_code::text,'null')||'. Next action='||coalesce(new.next_action,'')||'.';
  v_hash := encode(extensions.digest(v_content,'sha256'),'hex');
  insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience)
  values('episodic','Mission outcome '||new.mission_id,v_content,v_hash,'mission',new.mission_id,
         jsonb_build_object('capture','mission_state_trigger','status',new.status,'mission_id',new.mission_id),
         jsonb_build_object('goal',new.goal,'status',new.status,'completed_steps',new.completed_steps,'total_steps',new.total_steps,'recovery_count',new.recovery_count),
         case when new.status='succeeded' then 1 else .85 end,.8,.9)
  on conflict(content_hash) do update set updated_at=now()
  returning memory_id into v_id;
  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
  values(v_id,'created',new.mission_id,jsonb_build_object('trigger','mission_state','status',new.status));
  return new;
end;
$$;

drop trigger if exists trg_aria_memory_capture_mission_outcome on aria_internal.mission_state;
create trigger trg_aria_memory_capture_mission_outcome
after update of status on aria_internal.mission_state
for each row execute function aria_memory.capture_mission_outcome();
revoke all on function aria_memory.capture_mission_outcome() from public,anon,authenticated;
