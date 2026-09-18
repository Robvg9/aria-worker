create table if not exists aria_internal.meditation_queue (
  queue_id text primary key default ('mq_' || gen_random_uuid()::text),
  device_id text not null references aria_internal.device_registry(device_id) on delete cascade,
  item_type text not null check (item_type in ('goal','mission')),
  item_id text not null,
  resolved_mission_id text null references aria_internal.mission_state(mission_id) on delete set null,
  position integer not null check (position > 0),
  status text not null default 'queued' check (status in ('queued','running','paused','completed','failed','blocked','cancelled')),
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique(device_id,item_type,item_id)
);

create index if not exists meditation_queue_device_status_position_idx
  on aria_internal.meditation_queue(device_id,status,position);

create index if not exists meditation_queue_resolved_mission_idx
  on aria_internal.meditation_queue(resolved_mission_id);

alter table aria_internal.meditation_queue enable row level security;

create or replace function aria_internal.meditation_queue_add(
  p_device_id text, p_item_type text, p_item_id text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_existing aria_internal.meditation_queue; v_position integer; v_row aria_internal.meditation_queue; v_goal aria_internal.autonomy_goals; v_mission aria_internal.mission_state;
begin
  if p_item_type not in ('goal','mission') then raise exception 'invalid_queue_item_type'; end if;
  if not exists (select 1 from aria_internal.device_registry where device_id=p_device_id and status <> 'disabled') then raise exception 'device_not_available'; end if;
  select * into v_existing from aria_internal.meditation_queue where device_id=p_device_id and item_type=p_item_type and item_id=p_item_id and status in ('queued','running','paused') limit 1;
  if found then return to_jsonb(v_existing); end if;
  if p_item_type='goal' then
    select * into v_goal from aria_internal.autonomy_goals where goal_id=p_item_id;
    if not found then raise exception 'goal_not_found'; end if;
    if v_goal.status='completed' then raise exception 'goal_terminal'; end if;
  else
    select * into v_mission from aria_internal.mission_state where mission_id=p_item_id;
    if not found then raise exception 'mission_not_found'; end if;
    if v_mission.status in ('succeeded','failed','blocked','cancelled') then raise exception 'mission_terminal'; end if;
  end if;
  select coalesce(max(position),0)+1 into v_position from aria_internal.meditation_queue where device_id=p_device_id and status in ('queued','running','paused');
  insert into aria_internal.meditation_queue(device_id,item_type,item_id,position,status,metadata,updated_at)
  values(p_device_id,p_item_type,p_item_id,v_position,'queued',jsonb_build_object('source','meditation-center-v1','manual',true),now())
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function aria_internal.meditation_queue_claim_next(p_device_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row aria_internal.meditation_queue;
begin
  update aria_internal.meditation_queue q
  set status='running', started_at=coalesce(started_at,now()), updated_at=now()
  where q.queue_id = (
    select queue_id from aria_internal.meditation_queue
    where device_id=p_device_id and status='queued'
    order by position asc, created_at asc
    for update skip locked limit 1
  )
  returning q.* into v_row;
  if not found then return null; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function aria_internal.meditation_queue_remove(p_device_id text,p_queue_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row aria_internal.meditation_queue;
begin
  update aria_internal.meditation_queue
  set status='cancelled', updated_at=now(), completed_at=case when status in ('completed','cancelled') then completed_at else now() end
  where queue_id=p_queue_id and device_id=p_device_id and status in ('queued','paused','failed','blocked')
  returning * into v_row;
  if not found then return null; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function aria_internal.meditation_queue_resequence(p_device_id text,p_queue_ids text[])
returns integer language plpgsql security invoker set search_path='' as $$
declare v_id text; v_pos integer:=1; v_count integer:=0;
begin
  foreach v_id in array p_queue_ids loop
    update aria_internal.meditation_queue set position=v_pos, updated_at=now()
    where queue_id=v_id and device_id=p_device_id and status='queued';
    if found then v_count:=v_count+1; v_pos:=v_pos+1; end if;
  end loop;
  return v_count;
end;
$$;

revoke all on aria_internal.meditation_queue from anon, authenticated;
