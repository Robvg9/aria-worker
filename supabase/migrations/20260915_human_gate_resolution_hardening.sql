CREATE OR REPLACE FUNCTION aria_internal.aria_mission_resolve_human_gate(p_mission_id text, p_resolution jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare
  r aria_internal.mission_state;
  gate_status text;
  step_id text;
  original_risk text;
  resolved_checkpoint jsonb;
begin
  if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
  select * into r from aria_internal.mission_state where mission_id=p_mission_id for update;
  if not found then raise exception 'mission_not_found'; end if;
  gate_status:=coalesce(r.checkpoint->'recovery'->>'status','');
  if gate_status not in ('waiting_for_human_gate','human_gate_pending') then raise exception 'human_gate_not_pending'; end if;
  step_id:=coalesce(
    nullif(r.checkpoint->'recovery'->>'waiting_step_id',''),
    nullif(r.checkpoint->'human_gate'->>'step_id',''),
    (select key from jsonb_each(coalesce(r.checkpoint->'pending_jobs','{}'::jsonb)) where coalesce(value->>'human_gate_required','false')='true' limit 1)
  );
  if coalesce(step_id,'')='' then raise exception 'human_gate_step_missing'; end if;
  original_risk:=coalesce(
    (select value->'input'->>'risk' from jsonb_array_elements(coalesce(r.checkpoint->'plan','[]'::jsonb)) t(value) where value->>'id'=step_id limit 1),
    (select value->>'risk' from jsonb_array_elements(coalesce(r.checkpoint->'plan','[]'::jsonb)) t(value) where value->>'id'=step_id limit 1),
    'UNKNOWN'
  );
  resolved_checkpoint:=jsonb_set(coalesce(r.checkpoint,'{}'::jsonb),'{recovery,status}',to_jsonb('human_gate_resolved'::text),true);
  resolved_checkpoint:=jsonb_set(resolved_checkpoint,'{recovery,resolution}',coalesce(p_resolution,'{}'::jsonb),true);
  resolved_checkpoint:=jsonb_set(resolved_checkpoint,'{human_gate}',jsonb_build_object(
    'approved',true,
    'step_id',step_id,
    'original_risk',original_risk,
    'resolution',coalesce(p_resolution,'{}'::jsonb),
    'resolved_at',clock_timestamp(),
    'resolution_ref',coalesce(p_resolution->>'resolution_ref','human_gate:'||p_mission_id)
  ),true);
  update aria_internal.mission_state set status='queued',lease_owner=null,lease_until=null,finished_at=null,next_action='resume: human gate resolved; scheduler may resume after current mission',checkpoint=resolved_checkpoint,updated_at=clock_timestamp() where mission_id=p_mission_id returning * into r;
  insert into aria_internal.mission_events(mission_id,event_type,payload) values(p_mission_id,'mission_resumed',jsonb_build_object('kind','human_gate_resolved','step_id',step_id,'original_risk',original_risk,'resolution',coalesce(p_resolution,'{}'::jsonb),'resolved_at',clock_timestamp()));
  return to_jsonb(r);
end;
$function$;
