-- Meditation IA: keep mission_steps synchronized with the canonical mission checkpoint/event stream.
-- This is deliberately additive: it does not alter mission execution semantics.

create or replace function aria_internal.aria_materialize_mission_steps_from_state()
returns trigger
language plpgsql
security definer
set search_path = aria_internal, pg_temp
as $$
declare
  plan_item jsonb;
  idx integer := 0;
  step_id text;
  step_status text;
  completed_ids jsonb := coalesce(new.checkpoint -> 'completed_steps', '[]'::jsonb);
  results jsonb := coalesce(new.checkpoint -> 'results', '{}'::jsonb);
  result_item jsonb;
  operation text;
  command_text text;
  agent text;
  started timestamptz;
  completed timestamptz;
begin
  if jsonb_typeof(coalesce(new.checkpoint -> 'plan', '[]'::jsonb)) <> 'array' then
    return new;
  end if;

  for plan_item in select value from jsonb_array_elements(new.checkpoint -> 'plan') loop
    idx := idx + 1;
    step_id := coalesce(plan_item ->> 'id', format('step_%s', idx));
    operation := nullif(coalesce(plan_item ->> 'operation', plan_item -> 'input' ->> 'operation'), '');
    command_text := nullif(coalesce(plan_item -> 'input' ->> 'command', plan_item ->> 'command'), '');
    agent := nullif(coalesce(plan_item ->> 'agent_id', plan_item -> 'target' ->> 'agent_id'), '');

    if completed_ids @> jsonb_build_array(step_id) then
      step_status := 'succeeded';
    elsif (results -> step_id ->> 'status') in ('failed', 'timeout') then
      step_status := 'failed';
    elsif new.status = 'blocked' then
      step_status := 'blocked';
    elsif new.status = 'paused' and (new.checkpoint -> 'pending_jobs') ? step_id then
      step_status := 'waiting';
    elsif new.status = 'running' and coalesce(new.current_step, 0) = idx - 1 then
      step_status := 'running';
    else
      step_status := 'pending';
    end if;

    result_item := results -> step_id;
    started := case when step_status in ('running','succeeded','failed','waiting','blocked') then
      coalesce((result_item ->> 'started_at')::timestamptz, null) else null end;
    completed := case when step_status in ('succeeded','failed','skipped') then
      coalesce((result_item ->> 'completed_at')::timestamptz, now()) else null end;

    insert into aria_internal.mission_steps (
      mission_id, step_index, title, status, agent_id, operation, command, result,
      attempt_count, started_at, completed_at, updated_at
    ) values (
      new.mission_id,
      idx,
      coalesce(nullif(plan_item ->> 'title', ''), operation, format('Paso %s', idx)),
      step_status,
      agent,
      operation,
      command_text,
      coalesce(result_item, '{}'::jsonb),
      greatest(0, coalesce((new.checkpoint -> 'attempts' -> step_id)::integer, 0)),
      started,
      completed,
      now()
    )
    on conflict (mission_id, step_index) do update set
      title = excluded.title,
      status = excluded.status,
      agent_id = excluded.agent_id,
      operation = excluded.operation,
      command = excluded.command,
      result = excluded.result,
      attempt_count = excluded.attempt_count,
      started_at = coalesce(aria_internal.mission_steps.started_at, excluded.started_at),
      completed_at = coalesce(excluded.completed_at, aria_internal.mission_steps.completed_at),
      updated_at = now();
  end loop;

  return new;
end;
$$;

create or replace function aria_internal.aria_materialize_mission_step_event()
returns trigger
language plpgsql
security definer
set search_path = aria_internal, pg_temp
as $$
declare
  step_id text;
  idx integer;
  ev_payload jsonb := coalesce(new.payload, '{}'::jsonb);
  new_status text;
  result_json jsonb;
  started timestamptz;
  finished timestamptz;
begin
  if new.event_type not in ('step_started','step_succeeded','step_failed','execution_timeout') then
    return new;
  end if;
  step_id := coalesce(ev_payload ->> 'step_id', '');
  if step_id = '' then return new; end if;

  select ordinality::integer into idx
  from jsonb_array_elements(coalesce((select checkpoint from aria_internal.mission_state where mission_id = new.mission_id) -> 'plan', '[]'::jsonb)) with ordinality as p(value, ordinality)
  where coalesce(p.value ->> 'id', format('step_%s', p.ordinality)) = step_id
  limit 1;

  if idx is null then return new; end if;

  new_status := case new.event_type
    when 'step_started' then 'running'
    when 'step_succeeded' then 'succeeded'
    when 'step_failed' then 'failed'
    else 'failed'
  end;

  started := case when new.event_type = 'step_started' then coalesce(new.created_at, now()) else null end;
  finished := case when new.event_type in ('step_succeeded','step_failed','execution_timeout') then coalesce(new.created_at, now()) else null end;
  result_json := ev_payload;

  insert into aria_internal.mission_steps (
    mission_id, step_index, title, status, agent_id, operation, command, result,
    attempt_count, started_at, completed_at, updated_at
  ) values (
    new.mission_id,
    idx,
    coalesce(ev_payload ->> 'title', ev_payload ->> 'operation', format('Paso %s', idx)),
    new_status,
    nullif(ev_payload ->> 'agent_id', ''),
    nullif(ev_payload ->> 'operation', ''),
    nullif(ev_payload ->> 'command', ''),
    result_json,
    greatest(0, coalesce((ev_payload ->> 'attempt')::integer, 0)),
    started,
    finished,
    coalesce(new.created_at, now())
  )
  on conflict (mission_id, step_index) do update set
    status = excluded.status,
    agent_id = coalesce(excluded.agent_id, aria_internal.mission_steps.agent_id),
    operation = coalesce(excluded.operation, aria_internal.mission_steps.operation),
    command = coalesce(excluded.command, aria_internal.mission_steps.command),
    result = excluded.result,
    attempt_count = greatest(aria_internal.mission_steps.attempt_count, excluded.attempt_count),
    started_at = coalesce(aria_internal.mission_steps.started_at, excluded.started_at),
    completed_at = coalesce(excluded.completed_at, aria_internal.mission_steps.completed_at),
    updated_at = coalesce(new.created_at, now());

  return new;
end;
$$;

drop trigger if exists trg_materialize_mission_steps_from_state on aria_internal.mission_state;
create trigger trg_materialize_mission_steps_from_state
after insert or update of checkpoint, status, current_step, completed_steps on aria_internal.mission_state
for each row execute function aria_internal.aria_materialize_mission_steps_from_state();

drop trigger if exists trg_materialize_mission_step_event on aria_internal.mission_events;
create trigger trg_materialize_mission_step_event
after insert on aria_internal.mission_events
for each row execute function aria_internal.aria_materialize_mission_step_event();

comment on function aria_internal.aria_materialize_mission_steps_from_state() is
  'Meditation IA v1: materialize canonical checkpoint plan into mission_steps for progress/ETA telemetry.';
comment on function aria_internal.aria_materialize_mission_step_event() is
  'Meditation IA v1: materialize step lifecycle events into mission_steps timing/status telemetry.';
