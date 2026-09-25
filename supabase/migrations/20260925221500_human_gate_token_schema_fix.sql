-- Fix Human Gate approval token generation with the actual pgcrypto schema.
create or replace function aria_internal.mission_human_gate_decide(
  p_mission_id text,
  p_decision text,
  p_approver_id text,
  p_action_hash text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, aria_internal
as $$
declare
  r aria_internal.mission_state;
  gate jsonb;
  decision text := lower(btrim(coalesce(p_decision,'')));
  approver text := btrim(coalesce(p_approver_id,''));
  provided_hash text := btrim(coalesce(p_action_hash,''));
  approval_token text;
  new_status text;
begin
  if coalesce(btrim(p_mission_id),'')='' then raise exception 'mission_id_required'; end if;
  if decision not in ('approve','reject','cancel') then raise exception 'invalid_human_gate_decision'; end if;
  if approver='' then raise exception 'approver_required'; end if;

  select * into r from aria_internal.mission_state where mission_id=p_mission_id for update;
  if not found then raise exception 'mission_not_found'; end if;

  gate := coalesce(r.checkpoint->'human_gate','{}'::jsonb);
  if coalesce((gate->>'required')::boolean,false) is not true
     or coalesce(btrim(gate->>'step_id'),'')=''
     or coalesce(btrim(gate->>'action_hash'),'')='' then
    raise exception 'human_gate_not_pending';
  end if;
  if r.status <> 'paused' then raise exception 'human_gate_wrong_state:%',r.status; end if;

  if decision='approve' then
    if provided_hash='' or provided_hash <> (gate->>'action_hash') then
      raise exception 'human_gate_action_mismatch';
    end if;
    approval_token := encode(extensions.gen_random_bytes(32),'hex');
    new_status := 'approved';
  elsif decision='reject' then
    if provided_hash<>'' and provided_hash <> (gate->>'action_hash') then raise exception 'human_gate_action_mismatch'; end if;
    approval_token := null;
    new_status := 'rejected';
  else
    if provided_hash<>'' and provided_hash <> (gate->>'action_hash') then raise exception 'human_gate_action_mismatch'; end if;
    approval_token := null;
    new_status := 'cancelled';
  end if;

  update aria_internal.mission_state
     set status=case when decision='approve' then 'queued' else new_status end,
         next_action=case when decision='approve' then 'resume:human_gate_approved' when decision='reject' then 'terminal:human_gate_rejected' else 'terminal:human_gate_cancelled' end,
         lease_owner=null, lease_until=null,
         checkpoint=jsonb_set(
           jsonb_set(coalesce(checkpoint,'{}'::jsonb),'{human_gate,status}',to_jsonb(new_status),true),
           '{human_gate,verified}','false'::jsonb,true
         ) || jsonb_build_object('human_gate',
           coalesce(checkpoint->'human_gate','{}'::jsonb) || jsonb_build_object(
             'required',true,'status',new_status,'decision',decision,'decision_at',clock_timestamp()::text,
             'approved_by',case when decision='approve' then approver else null end,
             'rejected_by',case when decision='reject' then approver else null end,
             'cancelled_by',case when decision='cancel' then approver else null end,
             'note',nullif(p_note,''),'approval_token',approval_token,
             'approved_at',case when decision='approve' then clock_timestamp()::text else null end
           )
         ),
         updated_at=clock_timestamp()
   where mission_id=p_mission_id
   returning * into r;

  insert into aria_internal.mission_events(mission_id,event_type,payload)
  values(p_mission_id,
    case when decision='approve' then 'human_gate_approved' when decision='reject' then 'human_gate_rejected' else 'human_gate_cancelled' end,
    jsonb_build_object('step_id',gate->>'step_id','action_hash',gate->>'action_hash','decision',decision,'approver_id',approver,'note',nullif(p_note,'')));

  return jsonb_build_object('mission_id',p_mission_id,'step_id',gate->>'step_id','decision',decision,
    'status',case when decision='approve' then 'queued' else new_status end,'action_hash',gate->>'action_hash','approval_token_issued',decision='approve');
end;
$$;

revoke all on function aria_internal.mission_human_gate_decide(text,text,text,text,text) from public, anon, authenticated;
grant execute on function aria_internal.mission_human_gate_decide(text,text,text,text,text) to service_role;
