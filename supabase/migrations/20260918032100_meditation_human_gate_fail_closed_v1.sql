-- Fail closed: a real Meditation Human Gate must be completed before succeeded.
create or replace function aria_internal.enforce_meditation_human_gate_before_succeeded()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, aria_internal
as $$
declare gate jsonb;
begin
  if new.status='succeeded' and coalesce(new.metadata->>'source',old.metadata->>'source')='meditation-ia-v1' then
    gate:=coalesce(new.metadata->'human_gate',old.metadata->'human_gate');
    if jsonb_typeof(gate)='object' and coalesce((gate->>'enabled')::boolean,false) is true and coalesce(btrim(gate->>'method'),'')<>'' then
      if coalesce(new.checkpoint->'human_gate'->>'status','')<>'completed'
         or coalesce(new.checkpoint->'human_gate'->>'verified','false')<>'true'
         or not exists (select 1 from aria_internal.mission_events e where e.mission_id=new.mission_id and e.event_type='human_gate_completed' and coalesce((e.payload->>'verified')::boolean,false)=true)
      then raise exception 'human_gate_required:completion_pending'; end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_meditation_human_gate_before_succeeded on aria_internal.mission_state;
create trigger trg_meditation_human_gate_before_succeeded before update of status on aria_internal.mission_state for each row execute function aria_internal.enforce_meditation_human_gate_before_succeeded();
revoke all on function aria_internal.enforce_meditation_human_gate_before_succeeded() from public, anon, authenticated;
grant execute on function aria_internal.enforce_meditation_human_gate_before_succeeded() to service_role;