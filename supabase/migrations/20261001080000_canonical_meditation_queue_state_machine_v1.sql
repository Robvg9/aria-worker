-- ARIA canonical Meditation queue state machine v1
-- Structural fixes:
-- 1) a runner batch must remain RUNNING in the queue until the mission is terminal;
-- 2) stale queue rows are reconciled from canonical mission_state;
-- 3) scheduler timeout matches real runner latency;
-- 4) primary objectives get a deterministic execution lane ahead of idea/test backlog.

create or replace function aria_internal.reconcile_meditation_queue_v2()
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal'
as $function$
declare
  n_completed integer := 0;
  n_failed integer := 0;
  n_blocked integer := 0;
  n_cancelled integer := 0;
  n_missing integer := 0;
  n_resumed integer := 0;
  n_demoted integer := 0;
begin
  update aria_internal.meditation_queue q
     set status = 'failed',
         last_error = 'mission_not_found',
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where q.status in ('queued','running','paused')
     and q.item_type = 'mission'
     and not exists (
       select 1 from aria_internal.mission_state m
       where m.mission_id = q.item_id
     );
  get diagnostics n_missing = row_count;

  update aria_internal.meditation_queue q
     set status = case m.status
                    when 'succeeded' then 'completed'
                    when 'failed' then 'failed'
                    when 'blocked' then 'blocked'
                    when 'cancelled' then 'cancelled'
                    else q.status
                  end,
         last_error = case
                        when m.status in ('failed','blocked') then coalesce(m.last_stderr,m.next_action)
                        when m.status='succeeded' then null
                        else q.last_error
                      end,
         completed_at = case
                          when m.status in ('succeeded','failed','blocked','cancelled') then coalesce(q.completed_at,clock_timestamp())
                          else q.completed_at
                        end,
         updated_at = clock_timestamp()
    from aria_internal.mission_state m
   where q.item_type='mission'
     and q.item_id=m.mission_id
     and q.status in ('queued','running','paused')
     and m.status in ('succeeded','failed','blocked','cancelled');
  get diagnostics n_completed = row_count;

  select count(*) into n_resumed
  from aria_internal.meditation_queue q
  join aria_internal.mission_state m on m.mission_id=q.item_id
  where q.status='paused'
    and m.status='running'
    and m.lease_until is null
    and coalesce(m.next_action,'')='next_ready_batch';

  update aria_internal.meditation_queue q
     set status='running',
         last_error=null,
         completed_at=null,
         updated_at=clock_timestamp()
    from aria_internal.mission_state m
   where q.item_type='mission'
     and q.item_id=m.mission_id
     and q.status='paused'
     and m.status='running'
     and m.lease_until is null
     and coalesce(m.next_action,'')='next_ready_batch';

  update aria_internal.meditation_queue q
     set status='paused',
         updated_at=clock_timestamp()
    from aria_internal.mission_state m
   where q.item_type='mission'
     and q.item_id=m.mission_id
     and q.status='running'
     and m.status='paused'
     and coalesce(m.next_action,'')<>'next_ready_batch';
  get diagnostics n_demoted = row_count;

  n_failed := n_missing;
  return jsonb_build_object(
    'version','v2',
    'checked_at',clock_timestamp(),
    'queue_terminalized',n_completed,
    'queue_missing_mission',n_missing,
    'queue_continuations_resumed',n_resumed,
    'queue_running_demoted_to_paused',n_demoted,
    'queue_failed',n_failed
  );
end;
$function$;

revoke all on function aria_internal.reconcile_meditation_queue_v2() from public,anon,authenticated;
grant execute on function aria_internal.reconcile_meditation_queue_v2() to service_role;

create or replace function aria_internal.aria_mission_claim_next_lease(
  p_worker_id text,
  p_lease_for interval default interval '2 minutes'
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal'
as $function$
declare claimed jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id)='' then
    raise exception 'worker_id_required';
  end if;

  with candidates as (
    select m.mission_id
      from aria_internal.mission_state m
     where (
       m.status='queued'
       or (m.status in ('planning','running','paused','failed') and m.lease_until is not null and m.lease_until<clock_timestamp())
       or (m.status='running' and m.lease_owner is null
           and not (coalesce(m.next_action,'')='next_ready_batch'
                    and m.updated_at > clock_timestamp()-interval '10 minutes'))
       or (m.status='running' and m.lease_until is null
           and not (coalesce(m.next_action,'')='next_ready_batch'
                    and m.updated_at > clock_timestamp()-interval '10 minutes'))
       or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
     order by
       case lower(coalesce(m.metadata->>'execution_lane',''))
         when 'primary' then 0
         when 'repair' then 10
         when 'user' then 20
         when 'meditation' then 30
         when 'idea' then 90
         when 'test' then 100
         else 50
       end,
       m.updated_at,
       m.created_at,
       m.mission_id
     for update skip locked
     limit 1
  ), updated as (
    update aria_internal.mission_state m
       set status=case
         when m.status in ('queued','failed') then 'planning'
         when m.status='waiting' then 'running'
         else 'running'
       end,
       lease_owner=p_worker_id,
       lease_until=clock_timestamp()+p_lease_for,
       updated_at=clock_timestamp(),
       current_workspace=coalesce(m.current_workspace,p_worker_id),
       recovery_count=case
         when m.status='paused' then coalesce(m.recovery_count,0)+1
         when m.status in ('planning','running','failed')
           and m.lease_until is not null and m.lease_until<clock_timestamp()
           then coalesce(m.recovery_count,0)+1
         else coalesce(m.recovery_count,0)
       end,
       last_recovery_reason=case
         when m.status='failed' then 'failed_mission_replanned'
         when m.status='waiting' then 'verification_pending_resumed'
         when m.status='paused' then 'paused_pending_job_reclaimed'
         when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
         else m.last_recovery_reason
       end,
       next_action=case
         when m.status='failed' then 'replan: prior strategy failed'
         when m.status='waiting' then 'verification:resume_pending_verification'
         else m.next_action
       end
      from candidates c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;

revoke all on function aria_internal.aria_mission_claim_next_lease(text,interval) from public,anon,authenticated;
grant execute on function aria_internal.aria_mission_claim_next_lease(text,interval) to service_role;

create or replace function aria_internal.run_mission_runner_tick_v1()
returns bigint
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal','vault','net'
as $function$
declare rid bigint;
begin
  perform aria_internal.reconcile_meditation_queue_v2();

  if (
    select count(*)
      from aria_internal.mission_state m
     where m.status in ('planning','running')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  ) >= 2 then
    return null;
  end if;

  if exists (
    select 1
      from aria_internal.mission_state m
     where m.status in ('planning','running')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
       and coalesce(m.next_action,'') not like 'resume: pending device job%'
  ) then
    return null;
  end if;

  if not exists (
    select 1
      from aria_internal.mission_state m
     where (
       m.status='queued'
       or (m.status in ('planning','running','failed') and (m.lease_until is null or m.lease_until < clock_timestamp()))
       or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
  ) then
    return null;
  end if;

  select net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v22',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into rid;

  return rid;
end;
$function$;

revoke all on function aria_internal.run_mission_runner_tick_v1() from public,anon,authenticated;
grant execute on function aria_internal.run_mission_runner_tick_v1() to service_role;

-- Existing idea-converted missions keep their human-approved queue records.
-- New conversions are explicitly marked as the low-priority IDEA execution lane.
create or replace function aria_internal.meditation_idea_convert_mission(
  p_proposal_id uuid,
  p_owner_user_id uuid,
  p_device_id text,
  p_template_mission_id text
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal'
as $function$
declare
  v_proposal aria_internal.meditation_idea_proposals;
  v_template jsonb;
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
  v_total integer;
  v_converted_count integer;
  v_next_status text;
begin
  if p_owner_user_id is null then raise exception 'owner_user_id_required'; end if;
  if nullif(btrim(coalesce(p_device_id,'')),'') is null then raise exception 'device_id_required'; end if;
  if nullif(btrim(coalesce(p_template_mission_id,'')),'') is null then raise exception 'template_mission_id_required'; end if;

  select * into v_proposal from aria_internal.meditation_idea_proposals
   where proposal_id=p_proposal_id for update;
  if not found then raise exception 'proposal_not_found'; end if;
  if v_proposal.owner_user_id is null or v_proposal.owner_user_id<>p_owner_user_id then raise exception 'proposal_not_owned'; end if;
  if v_proposal.status not in ('accepted','converted') then raise exception 'proposal_must_be_accepted'; end if;
  if coalesce(v_proposal.metadata->'decision'->>'action','')<>'accept' then
    raise exception 'explicit_acceptance_required';
  end if;

  if not exists (select 1 from aria_internal.device_registry where device_id=p_device_id and status='online') then
    raise exception 'device_not_online';
  end if;

  select x.value into v_template
    from jsonb_array_elements(coalesce(v_proposal.missions,'[]'::jsonb)) x(value)
   where x.value->>'mission_id'=p_template_mission_id limit 1;
  if v_template is null then raise exception 'proposal_template_not_found'; end if;

  select * into v_existing from aria_internal.mission_state
   where metadata->>'idea_proposal_id'=p_proposal_id::text
     and metadata->>'idea_template_mission_id'=p_template_mission_id
   order by created_at asc limit 1;

  if found then
    select to_jsonb(q) into v_queue
      from aria_internal.meditation_queue q
     where q.device_id=p_device_id and q.item_type='mission' and q.item_id=v_existing.mission_id
     order by q.created_at desc limit 1;
    return jsonb_build_object('ok',true,'deduplicated',true,'proposal_id',p_proposal_id,'status',v_proposal.status,'mission',to_jsonb(v_existing),'queue',coalesce(v_queue,'null'::jsonb));
  end if;

  v_goal:=coalesce(nullif(v_template->>'goal',''),nullif(v_proposal.objective->>'text',''),v_proposal.idea);
  v_gate_enabled:=coalesce((v_template->'human_gate'->>'enabled')::boolean,false);
  v_gate_risk:=coalesce(nullif(v_template->>'risk',''),'HIGH_RISK_WRITE');
  if v_gate_enabled then v_gate_required:=jsonb_build_array(v_gate_risk); end if;

  v_mission_id:='idea_'||gen_random_uuid()::text;
  v_metadata:=jsonb_build_object(
    'source','meditation-idea-analyzer-v2',
    'execution_lane','idea',
    'activation','human_accept_and_create_mission',
    'user_id',p_owner_user_id,
    'owner_user_id',p_owner_user_id,
    'device_id',p_device_id,
    'idea_proposal_id',p_proposal_id,
    'idea_template_mission_id',p_template_mission_id,
    'idea_schema_version',coalesce(v_proposal.schema_version,'idea-to-mission-v1'),
    'display_title',coalesce(v_template->>'title','Misión derivada de una idea'),
    'idea_classification',coalesce(v_proposal.classification,'{}'::jsonb),
    'idea_objective',coalesce(v_proposal.objective,'{}'::jsonb),
    'idea_proposed_steps',coalesce(v_template->'steps','[]'::jsonb),
    'human_gate_required',v_gate_required,
    'human_gate',case when v_gate_enabled then jsonb_build_object(
      'enabled',true,'method','manual_confirmation',
      'reason','La propuesta requiere decisión humana antes de continuar.',
      'instructions','Revisa la acción, destino y alcance antes de aprobar.'
    ) else jsonb_build_object('enabled',false) end
  );

  select public.aria_mission_create(jsonb_build_object(
    'mission_id',v_mission_id,'status','queued','goal',v_goal,
    'current_step',0,'completed_steps',0,
    'checkpoint',jsonb_build_object(
      'idea_analyzer',jsonb_build_object(
        'version','idea-analyzer-v2','proposal_id',p_proposal_id,
        'template_mission_id',p_template_mission_id,'proposal_status',v_proposal.status
      )
    ),
    'metadata',v_metadata
  )) into v_mission;

  select aria_internal.meditation_queue_add(p_device_id,'mission',v_mission_id) into v_queue;

  v_converted:=coalesce(v_proposal.metadata->'converted_missions','[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'template_mission_id',p_template_mission_id,'mission_id',v_mission_id,
      'queue_id',v_queue->>'queue_id','converted_at',clock_timestamp()
    ));
  v_total:=jsonb_array_length(coalesce(v_proposal.missions,'[]'::jsonb));
  select count(*) into v_converted_count
    from (select distinct value->>'template_mission_id' template_id
            from jsonb_array_elements(v_converted) where nullif(value->>'template_mission_id','') is not null) s;
  v_next_status:=case when v_total>0 and v_converted_count>=v_total then 'converted' else 'accepted' end;

  update aria_internal.meditation_idea_proposals
     set status=v_next_status,
         metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{converted_missions}',v_converted,true),
         updated_at=clock_timestamp()
   where proposal_id=p_proposal_id;

  select * into v_existing from aria_internal.mission_state where mission_id=v_mission_id;
  return jsonb_build_object('ok',true,'deduplicated',false,'proposal_id',p_proposal_id,'status',v_next_status,'mission',to_jsonb(v_existing),'queue',v_queue);
end;
$function$;

revoke all on function aria_internal.meditation_idea_convert_mission(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function aria_internal.meditation_idea_convert_mission(uuid,uuid,text,text) to service_role;
