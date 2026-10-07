-- ARIA Meditación IA: Idea Analyzer v3
-- One proposal presents three plan options, and choosing one creates exactly one mission.
-- This leaves the v1/v2 conversion RPCs intact for historical proposals.

create or replace function aria_internal.meditation_idea_convert_mission_v3(
  p_proposal_id uuid,
  p_owner_user_id uuid,
  p_device_id text,
  p_plan_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $function$
declare
  v_proposal aria_internal.meditation_idea_proposals;
  v_template jsonb;
  v_plan jsonb;
  v_existing aria_internal.mission_state;
  v_mission jsonb;
  v_queue jsonb;
  v_mission_id text;
  v_goal text;
  v_gate_enabled boolean := false;
  v_gate_risk text;
  v_gate_required jsonb := '[]'::jsonb;
  v_metadata jsonb;
  v_converted jsonb;
begin
  if p_owner_user_id is null then raise exception 'owner_user_id_required'; end if;
  if nullif(btrim(coalesce(p_device_id,'')),'') is null then raise exception 'device_id_required'; end if;
  if nullif(btrim(coalesce(p_plan_id,'')),'') is null then raise exception 'plan_id_required'; end if;

  select * into v_proposal
    from aria_internal.meditation_idea_proposals
   where proposal_id=p_proposal_id
   for update;

  if not found then raise exception 'proposal_not_found'; end if;
  if v_proposal.owner_user_id is null or v_proposal.owner_user_id<>p_owner_user_id then
    raise exception 'proposal_not_owned';
  end if;
  if v_proposal.status not in ('accepted','converted') then
    raise exception 'proposal_must_be_accepted';
  end if;
  if coalesce(v_proposal.schema_version,'') <> 'idea-to-mission-v3' then
    raise exception 'proposal_not_v3';
  end if;

  select x.value into v_template
    from jsonb_array_elements(coalesce(v_proposal.missions,'[]'::jsonb)) x(value)
   limit 1;
  if v_template is null then raise exception 'proposal_template_not_found'; end if;

  select x.value into v_plan
    from jsonb_array_elements(coalesce(v_template->'plans','[]'::jsonb)) x(value)
   where x.value->>'id'=p_plan_id
   limit 1;
  if v_plan is null then raise exception 'proposal_plan_not_found'; end if;

  if not exists (
    select 1
      from aria_internal.device_registry
     where device_id=p_device_id
       and status='online'
  ) then
    raise exception 'device_not_online';
  end if;

  select * into v_existing
    from aria_internal.mission_state
   where metadata->>'idea_proposal_id'=p_proposal_id::text
     and metadata->>'idea_plan_id'=p_plan_id
   order by created_at asc
   limit 1;

  if found then
    select to_jsonb(q) into v_queue
      from aria_internal.meditation_queue q
     where q.device_id=p_device_id
       and q.item_type='mission'
       and q.item_id=v_existing.mission_id
     order by q.created_at desc
     limit 1;

    return jsonb_build_object(
      'ok',true,
      'deduplicated',true,
      'proposal_id',p_proposal_id,
      'plan_id',p_plan_id,
      'status',v_proposal.status,
      'mission',to_jsonb(v_existing),
      'queue',coalesce(v_queue,'null'::jsonb)
    );
  end if;

  v_goal:=coalesce(
    nullif(v_plan->>'goal',''),
    nullif(v_template->>'goal',''),
    nullif(v_proposal.objective->>'text',''),
    v_proposal.idea
  );
  v_gate_enabled:=coalesce((v_plan->'human_gate'->>'enabled')::boolean,false);
  v_gate_risk:=coalesce(nullif(v_plan->>'risk',''),'HIGH_RISK_WRITE');
  if v_gate_enabled then v_gate_required:=jsonb_build_array(v_gate_risk); end if;

  v_mission_id:='idea_'||gen_random_uuid()::text;
  v_metadata:=jsonb_build_object(
    'source','meditation-idea-analyzer-v3',
    'execution_lane','idea',
    'activation','human_accept_and_choose_plan',
    'user_id',p_owner_user_id,
    'owner_user_id',p_owner_user_id,
    'device_id',p_device_id,
    'idea_proposal_id',p_proposal_id,
    'idea_template_mission_id',coalesce(v_template->>'mission_id','idea_mission_main'),
    'idea_plan_id',p_plan_id,
    'idea_plan',v_plan,
    'idea_schema_version',coalesce(v_proposal.schema_version,'idea-to-mission-v3'),
    'display_title',coalesce(v_plan->>'title',v_template->>'title','Misión derivada de una idea'),
    'idea_classification',coalesce(v_proposal.classification,'{}'::jsonb),
    'idea_objective',coalesce(v_proposal.objective,'{}'::jsonb),
    'idea_proposed_steps',coalesce(v_plan->'steps','[]'::jsonb),
    'human_gate_required',v_gate_required,
    'human_gate',case when v_gate_enabled then jsonb_build_object(
      'enabled',true,
      'method','manual_confirmation',
      'reason','La ruta requiere una decisión humana antes de continuar.',
      'instructions','Revisa alcance, destino y acción sensible antes de aprobar.'
    ) else jsonb_build_object('enabled',false) end
  );

  select public.aria_mission_create(jsonb_build_object(
    'mission_id',v_mission_id,
    'status','queued',
    'goal',v_goal,
    'current_step',0,
    'completed_steps',0,
    'checkpoint',jsonb_build_object(
      'idea_analyzer',jsonb_build_object(
        'version','idea-analyzer-v3',
        'proposal_id',p_proposal_id,
        'plan_id',p_plan_id,
        'proposal_status',v_proposal.status
      )
    ),
    'metadata',v_metadata
  )) into v_mission;

  select aria_internal.meditation_queue_add(p_device_id,'mission',v_mission_id) into v_queue;

  v_converted:=coalesce(v_proposal.metadata->'converted_missions','[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'plan_id',p_plan_id,
      'template_mission_id',coalesce(v_template->>'mission_id','idea_mission_main'),
      'mission_id',v_mission_id,
      'queue_id',v_queue->>'queue_id',
      'converted_at',clock_timestamp()
    ));

  update aria_internal.meditation_idea_proposals
     set status='converted',
         metadata=jsonb_set(
           jsonb_set(coalesce(metadata,'{}'::jsonb),'{converted_missions}',v_converted,true),
           '{selected_plan}',
           v_plan,
           true
         ),
         updated_at=clock_timestamp()
   where proposal_id=p_proposal_id;

  select * into v_existing
    from aria_internal.mission_state
   where mission_id=v_mission_id;

  return jsonb_build_object(
    'ok',true,
    'deduplicated',false,
    'proposal_id',p_proposal_id,
    'plan_id',p_plan_id,
    'status','converted',
    'mission',to_jsonb(v_existing),
    'queue',v_queue
  );
end;
$function$;

revoke all on function aria_internal.meditation_idea_convert_mission_v3(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function aria_internal.meditation_idea_convert_mission_v3(uuid,uuid,text,text) to service_role;
