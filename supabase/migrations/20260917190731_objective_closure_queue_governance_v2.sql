-- ARIA Objective Closure + Mission Queue Governance v2
-- Root causes addressed:
-- 1) Vision source status could drift from the canonical verified goal.
-- 2) Mission claim/create could admit stale, retry-exhausted, blocked, completed,
--    or duplicate-historical work, allowing dead work to remain in the active queue.
-- 3) One active mission per logical goal was conventionally enforced in RPC code,
--    but not transactionally enforced at the database boundary.

CREATE OR REPLACE FUNCTION aria_internal.sync_vision_objective_status_from_goal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare
  v_objective_id text := nullif(new.metadata->>'vision_objective_id','');
  v_status text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.source_type <> 'vision' or v_objective_id is null then return new; end if;
  if aria_internal.canonical_vision_goal_id(v_objective_id) <> new.goal_id then return new; end if;
  if coalesce(new.objective_verification_status,'UNVERIFIED')='DUPLICATE_HISTORICAL' then return new; end if;

  v_status := case
    when new.objective_verification_status='CONFIRMED'
         and new.status='completed'
      then 'completed'
    when new.objective_verification_status='BLOCKED_LEGITIMATE'
      then 'blocked'
    else 'queued'
  end;

  update aria_internal.vision_objectives
     set status=v_status,
         updated_at=clock_timestamp()
   where objective_id=v_objective_id
     and status is distinct from v_status;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_sync_vision_objective_status_from_goal ON aria_internal.autonomy_goals;
CREATE TRIGGER trg_sync_vision_objective_status_from_goal
AFTER UPDATE OF status, objective_verification_status ON aria_internal.autonomy_goals
FOR EACH ROW
EXECUTE FUNCTION aria_internal.sync_vision_objective_status_from_goal();

CREATE OR REPLACE FUNCTION aria_internal.guard_vision_objective_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare
  g aria_internal.autonomy_goals;
  v_goal_id text;
  v_evidence_mission text;
begin
  if new.status <> 'completed' then return new; end if;

  v_goal_id := aria_internal.canonical_vision_goal_id(new.objective_id);
  select * into g
    from aria_internal.autonomy_goals
   where goal_id=v_goal_id;

  v_evidence_mission := coalesce(
    g.objective_verification_evidence->>'mission_id',
    g.objective_verification_evidence->'verification_result'->>'mission_id',
    ''
  );

  if not found
     or g.status <> 'completed'
     or coalesce(g.objective_verification_status,'UNVERIFIED') <> 'CONFIRMED'
     or g.objective_verified_at is null
     or g.last_mission_id is null
     or v_evidence_mission <> g.last_mission_id then
    new.status := 'queued';
    new.updated_at := clock_timestamp();
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_guard_vision_objective_completion ON aria_internal.vision_objectives;
CREATE TRIGGER trg_guard_vision_objective_completion
BEFORE INSERT OR UPDATE OF status ON aria_internal.vision_objectives
FOR EACH ROW
EXECUTE FUNCTION aria_internal.guard_vision_objective_completion();

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_eligible(p_mission_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
select exists (
  select 1
    from aria_internal.mission_state m
    left join aria_internal.autonomy_goals g
      on g.goal_id=coalesce(m.metadata->>'goal_id','')
    left join aria_internal.vision_objectives v
      on v.objective_id=coalesce(g.metadata->>'vision_objective_id','')
   where m.mission_id=p_mission_id
     and m.status in ('queued','failed','paused','planning','running')
     and coalesce(m.checkpoint->'recovery'->>'status','') not in (
       'waiting_for_human_gate','human_gate_pending','retry_exhausted'
     )
     and not (
       m.status='failed'
       and coalesce(m.last_recovery_reason,'')='failed_mission_replanned'
       and coalesce(m.recovery_count,0)>=3
       and coalesce(m.checkpoint->'recovery'->>'failure_reason','')='coordinator_test_evidence_missing'
     )
     and (
       g.goal_id is null
       or (
         coalesce(g.objective_verification_status,'UNVERIFIED')<>'DUPLICATE_HISTORICAL'
         and coalesce(g.status,'')<>'completed'
         and (g.last_mission_id is null or g.last_mission_id=m.mission_id)
         and (
           coalesce(g.status,'')<>'blocked'
           or (
             g.last_mission_id=m.mission_id
             and (
               coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
               or coalesce(m.metadata->>'replan_required','')='true'
               or coalesce(m.metadata->>'resume_blocked_goal','')='true'
             )
           )
         )
         and (
           v.objective_id is null
           or v.status<>'completed'
           or coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
           or coalesce(m.metadata->>'replan_required','')='true'
           or coalesce(m.metadata->>'resume_blocked_goal','')='true'
         )
         and (
           jsonb_array_length(coalesce(g.metadata->'dependencies','[]'::jsonb))=0
           or not exists (
             select 1
               from jsonb_array_elements_text(coalesce(g.metadata->'dependencies','[]'::jsonb)) d(dep_id)
               left join aria_internal.autonomy_goals dep on dep.goal_id=d.dep_id
              where dep.goal_id is null
                 or dep.status<>'completed'
                 or dep.objective_verification_status<>'CONFIRMED'
           )
         )
       )
     )
);
$function$;

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_next_lease(
  p_worker_id text,
  p_lease_for interval DEFAULT '00:02:00'::interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
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
       or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
     order by m.updated_at,m.created_at,m.mission_id
     for update skip locked
     limit 1
  ), updated as (
    update aria_internal.mission_state m
       set status=case when m.status in ('queued','failed') then 'planning' else 'running' end,
           lease_owner=p_worker_id,
           lease_until=clock_timestamp()+p_lease_for,
           updated_at=clock_timestamp(),
           current_workspace=coalesce(m.current_workspace,p_worker_id),
           recovery_count=case
             when m.status='paused' then coalesce(m.recovery_count,0)+1
             when m.status in ('planning','running','failed') and m.lease_until is not null and m.lease_until<clock_timestamp()
               then coalesce(m.recovery_count,0)+1
             else coalesce(m.recovery_count,0)
           end,
           last_recovery_reason=case
             when m.status='failed' then 'failed_mission_replanned'
             when m.status='paused' then 'paused_pending_job_reclaimed'
             when m.lease_until is not null and m.lease_until<clock_timestamp() then 'lease_expired_reclaimed'
             else m.last_recovery_reason
           end,
           next_action=case
             when m.status='failed' then 'replan: prior strategy failed'
             when m.status='paused' then 'resume: pending execution job'
             else m.next_action
           end,
           checkpoint=aria_internal.aria_materialize_human_gate_approval(
             case when m.status='failed'
               then jsonb_set(
                 jsonb_set(coalesce(m.checkpoint,'{}'::jsonb),'{recovery,previous_plan}',coalesce(m.checkpoint->'plan','[]'::jsonb),true),
                 '{recovery,replan_required}','true'::jsonb,true
               )-'plan'-'completed_steps'-'attempts'-'results'-'pending_jobs'
               else m.checkpoint
             end
           )
      from candidates c
     where m.mission_id=c.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_next(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare claimed jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker_id_required';
  end if;

  with next_mission as (
    select m.mission_id
      from aria_internal.mission_state m
     where m.status='queued'
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
     order by m.created_at,m.mission_id
     for update skip locked
     limit 1
  ), updated as (
    update aria_internal.mission_state m
       set status='planning',
           updated_at=clock_timestamp(),
           next_action='planner_runtime',
           current_workspace=coalesce(current_workspace,p_worker_id)
      from next_mission n
     where m.mission_id=n.mission_id
     returning m.*
  )
  select to_jsonb(updated) into claimed from updated;
  return claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.aria_mission_create(p_mission jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare
  r jsonb;
  existing aria_internal.mission_state;
  g aria_internal.autonomy_goals;
  v_mission_id text:=coalesce(nullif(p_mission->>'mission_id',''),'mission_'||gen_random_uuid()::text);
  v_goal_id text:=nullif(p_mission->'metadata'->>'goal_id','');
  v_dynamic boolean:=coalesce((p_mission->'metadata'->>'dynamic_goal')::boolean,false);
  v_source text:=coalesce(p_mission->'metadata'->>'source','');
  v_replan boolean:=coalesce((p_mission->'metadata'->>'replan_required')::boolean,false)
                    or coalesce((p_mission->'metadata'->>'resume_blocked_goal')::boolean,false)
                    or coalesce((p_mission->'checkpoint'->'recovery'->>'replan_required')::boolean,false);
  v_objective_id text;
begin
  if v_goal_id is not null then
    select * into g from aria_internal.autonomy_goals where goal_id=v_goal_id;
    if found then
      if g.objective_verification_status='DUPLICATE_HISTORICAL' then
        raise exception 'goal_is_historical_duplicate';
      end if;
      if g.status='completed' or g.objective_verification_status='CONFIRMED' then
        raise exception 'goal_already_confirmed';
      end if;
      if g.status='blocked' and not v_replan then
        raise exception 'blocked_goal_requires_explicit_replan';
      end if;
      if g.source_type='vision' then
        v_objective_id:=nullif(g.metadata->>'vision_objective_id','');
        if v_objective_id is null then
          raise exception 'vision_goal_missing_objective_identity';
        end if;
        if aria_internal.canonical_vision_goal_id(v_objective_id)<>v_goal_id then
          raise exception 'vision_goal_not_canonical';
        end if;
      end if;

      select * into existing
        from aria_internal.mission_state
       where metadata->>'goal_id'=v_goal_id
         and status in ('queued','planning','running','waiting','paused')
       order by created_at desc,mission_id desc
       limit 1;
      if found then return to_jsonb(existing); end if;
    end if;
  end if;

  if v_dynamic or v_source like 'autonomy_supervisor_v10%' then
    if exists(select 1 from aria_internal.mission_state where status in ('queued','planning','running','waiting','paused')) then
      raise exception 'autonomy_global_inflight_limit';
    end if;
  end if;

  begin
    insert into aria_internal.mission_state(
      mission_id,status,goal,current_step,completed_steps,checkpoint,metadata
    )
    values(
      v_mission_id,'queued',coalesce(p_mission->>'goal',''),
      coalesce((p_mission->>'current_step')::int,0),
      coalesce((p_mission->>'completed_steps')::int,0),
      coalesce(p_mission->'checkpoint','{}'::jsonb),
      coalesce(p_mission->'metadata','{}'::jsonb)
    ) returning to_jsonb(mission_state.*) into r;
    return r;
  exception when unique_violation then
    if v_goal_id is not null then
      select * into existing
        from aria_internal.mission_state
       where metadata->>'goal_id'=v_goal_id
         and status in ('queued','planning','running','waiting','paused')
       order by created_at desc,mission_id desc
       limit 1;
      if found then return to_jsonb(existing); end if;
    end if;
    raise;
  end;
end;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS mission_state_one_active_mission_per_goal_idx
  ON aria_internal.mission_state ((metadata->>'goal_id'))
  WHERE metadata->>'goal_id' IS NOT NULL
    AND status IN ('queued','planning','running','waiting','paused');

-- Quarantine only stale/dead queue entries. Nothing is deleted; history remains intact.
UPDATE aria_internal.mission_state m
   SET status='cancelled',
       finished_at=coalesce(m.finished_at,clock_timestamp()),
       next_action='queue_governance_v2: quarantined stale/dead mission',
       last_stderr=left(coalesce(nullif(m.last_stderr,''),'')||case when coalesce(m.last_stderr,'')<>'' then E'\n' else '' end||'queue_governance_v2: mission removed from active queue because it is retry-exhausted, stale for its goal, or its goal is terminal.',4000),
       checkpoint=jsonb_set(
         coalesce(m.checkpoint,'{}'::jsonb),
         '{recovery,queue_governance}',
         jsonb_build_object('version','v2','status','quarantined','checked_at',clock_timestamp()),
         true
       ),
       updated_at=clock_timestamp()
 WHERE m.status='queued'
   AND (
     coalesce(m.checkpoint->'recovery'->>'status','')='retry_exhausted'
     OR exists (
       select 1
         from aria_internal.autonomy_goals g
        where g.goal_id=coalesce(m.metadata->>'goal_id','')
          and (
            g.objective_verification_status='DUPLICATE_HISTORICAL'
            or g.status='completed'
            or (
              g.status='blocked'
              and (
                g.last_mission_id is distinct from m.mission_id
                or not (
                  coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
                  or coalesce(m.metadata->>'replan_required','')='true'
                  or coalesce(m.metadata->>'resume_blocked_goal','')='true'
                )
              )
            )
          )
     )
   );

-- Bring the source Vision lifecycle into semantic agreement with already-confirmed canonical goals.
UPDATE aria_internal.vision_objectives v
   SET status='completed', updated_at=clock_timestamp()
 WHERE v.status<>'completed'
   AND EXISTS (
     SELECT 1
       FROM aria_internal.autonomy_goals g
      WHERE g.goal_id=aria_internal.canonical_vision_goal_id(v.objective_id)
        AND g.status='completed'
        AND g.objective_verification_status='CONFIRMED'
        AND g.objective_verified_at is not null
        AND coalesce(g.objective_verification_evidence->>'mission_id',
                     g.objective_verification_evidence->'verification_result'->>'mission_id','')=g.last_mission_id
   );
