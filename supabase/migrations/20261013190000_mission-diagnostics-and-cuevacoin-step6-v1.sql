-- Current-state corrective migration: suppress repeated duplicate recovery accounting and distinguish recent health from history.
-- Original operational evidence remains in mission_state; no historical rows are deleted.
CREATE OR REPLACE FUNCTION aria_internal.aria_autonomy_recover_stale_missions_heavy_v1(p_stale_after interval DEFAULT '00:02:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare
  n integer := 0;
  n_conflict integer := 0;
  n_recovered integer := 0;
begin
  -- Phase 1: stale missions whose goal already has another inflight mission
  -- are failed/replanned. This cannot create duplicate inflight rows.
  update aria_internal.mission_state m
     set status='failed',
         lease_owner=null,
         lease_until=null,
         current_step=0,
         completed_steps=0,
         attempt_count=0,
         next_action='replan: duplicate inflight goal prevented',
         last_stderr='duplicate_inflight_goal_prevented_during_stale_recovery',
         recovery_count=coalesce(m.recovery_count,0)+1,
         last_recovery_reason='duplicate_inflight_goal_prevented',
         updated_at=clock_timestamp(),
         finished_at=null,
         checkpoint=jsonb_set(
           jsonb_set(
             jsonb_set(
               coalesce(m.checkpoint,'{}'::jsonb),
               '{recovery,previous_plan}',
               coalesce(m.checkpoint->'plan','[]'::jsonb),
               true
             ),
             '{recovery,replan_required}',
             'true'::jsonb,
             true
           ),
           '{recovery,status}',
           '"replan_required"'::jsonb,
           true
         ) - 'plan' - 'completed_steps' - 'attempts' - 'results' - 'pending_jobs'
   where m.status in ('planning','running','paused','failed')
     and m.updated_at < clock_timestamp()-p_stale_after
     and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending'))
     and coalesce(m.last_stderr,'') <> 'duplicate_inflight_goal_prevented_during_stale_recovery'
     and nullif(m.metadata->>'goal_id','') is not null
     and exists (
       select 1
         from aria_internal.mission_state other
        where other.mission_id<>m.mission_id
          and other.status in ('queued','planning','running','waiting','paused')
          and nullif(other.metadata->>'goal_id','') = nullif(m.metadata->>'goal_id','')
     );
  get diagnostics n_conflict=row_count;

  -- Phase 2: recover at most ONE stale/retry-exhausted mission per goal.
  -- The old implementation evaluated NOT EXISTS against the same statement
  -- snapshot, so two rows for one goal could both become queued and collide
  -- with mission_state_one_inflight_goal_idx. Rank first, then update only rn=1.
  with candidates as (
    select m.mission_id,
           row_number() over (
             partition by nullif(m.metadata->>'goal_id','')
             order by m.created_at desc,m.mission_id desc
           ) as rn
      from aria_internal.mission_state m
     where (
       (m.status in ('planning','running','paused','failed')
        and m.updated_at < clock_timestamp()-p_stale_after)
       or
       (m.status='queued'
        and coalesce(m.checkpoint->'recovery'->>'status','')='retry_exhausted')
     )
       and not (coalesce(m.checkpoint->'recovery'->>'status','') in ('waiting_for_human_gate','human_gate_pending'))
       and nullif(m.metadata->>'goal_id','') is not null
       and not exists (
         select 1
           from aria_internal.mission_state other
          where other.mission_id<>m.mission_id
            and other.status in ('queued','planning','running','waiting','paused')
            and nullif(other.metadata->>'goal_id','') = nullif(m.metadata->>'goal_id','')
       )
  ),
  selected as (
    select mission_id from candidates where rn=1
  )
  update aria_internal.mission_state m
     set status=case when m.recovery_count >= 3 then 'failed' else 'queued' end,
         lease_owner=null,
         lease_until=null,
         current_step=case
           when m.status='failed' or m.recovery_count>=3 then 0
           else greatest(0,coalesce(m.current_step,0))
         end,
         completed_steps=case
           when m.status='failed' or m.recovery_count>=3 then 0
           else m.completed_steps
         end,
         attempt_count=case
           when m.status='failed' or m.recovery_count>=3 then 0
           else m.attempt_count
         end,
         next_action=case
           when m.recovery_count>=3 then 'replan: recovery exhausted after stale mission'
           when m.status='failed' then 'replan: prior strategy failed'
           else 'recovered: resume'
         end,
         last_stderr=case
           when m.recovery_count>=3 then coalesce(m.last_stderr,'recovery_exhausted_after_stale_mission')
           when m.status='failed' then coalesce(m.last_stderr,'prior_strategy_failed')
           else 'stale_mission_recovered_automatically'
         end,
         recovery_count=case when m.recovery_count>=3 then 0 else coalesce(m.recovery_count,0)+1 end,
         last_recovery_reason=case
           when m.recovery_count>=3 then 'recovery_exhausted_replan'
           when m.status='failed' then 'failed_strategy_replan'
           else 'stale_timeout'
         end,
         updated_at=clock_timestamp(),
         finished_at=null,
         checkpoint=case
           when m.status='failed'
             or m.recovery_count>=3
             or (m.status='queued' and coalesce(m.checkpoint->'recovery'->>'status','')='retry_exhausted')
           then jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(m.checkpoint,'{}'::jsonb),
                 '{recovery,previous_plan}',
                 coalesce(m.checkpoint->'plan','[]'::jsonb),
                 true
               ),
               '{recovery,replan_required}',
               'true'::jsonb,
               true
             ),
             '{recovery,status}',
             '"replan_required"'::jsonb,
             true
           ) - 'plan' - 'completed_steps' - 'attempts' - 'results' - 'pending_jobs'
           else m.checkpoint
         end
    where m.mission_id in (select mission_id from selected);
  get diagnostics n_recovered=row_count;

  n:=n_conflict+n_recovered;
  return n;
end;
$function$;


CREATE OR REPLACE FUNCTION aria_internal.get_operational_health_v1()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
with stats as (
  select
    (select count(*) from aria_internal.mission_state where status in ('planning','running','waiting')) as active_missions,
    (select count(*) from aria_internal.mission_state where status='blocked' and updated_at >= clock_timestamp()-interval '24 hours') as blocked_missions,
    (select count(*) from aria_internal.mission_state where status='blocked') as blocked_missions_total,
    (select count(*) from aria_internal.mission_state where status='failed' and updated_at >= clock_timestamp()-interval '24 hours' and coalesce(last_stderr,'') <> 'duplicate_inflight_goal_prevented_during_stale_recovery') as failed_24h,
    (select count(*) from aria_internal.mission_state where status='failed' and updated_at >= clock_timestamp()-interval '24 hours') as failed_24h_total,
    (select count(*) from aria_internal.mission_state where status='failed' and updated_at >= clock_timestamp()-interval '24 hours' and coalesce(last_stderr,'') = 'duplicate_inflight_goal_prevented_during_stale_recovery') as suppressed_duplicate_recovery_failures_24h,
    (select count(*) from aria_internal.execution_jobs where status='queued') as queued_jobs,
    (select count(*) from aria_internal.execution_jobs where status in ('claimed','running')) as running_jobs,
    (select count(*) from aria_internal.execution_jobs where status in ('claimed','running') and updated_at < clock_timestamp()-interval '10 minutes') as stale_jobs,
    (select count(*) from aria_internal.device_registry where status='online') as devices_online,
    (select count(*) from aria_internal.device_registry) as devices_total,
    (select count(*) from aria_internal.model_registry where enabled=true and status='available') as models_available,
    (select count(*) from aria_internal.model_registry) as models_total
)
select jsonb_build_object(
  'version','aria-operational-diagnostics-v1.1.0',
  'generated_at',clock_timestamp(),
  'status',case
    when stale_jobs > 0 or blocked_missions > 0 or failed_24h > 0 then 'degraded'
    when queued_jobs > 0 and devices_online = 0 then 'unavailable'
    else 'healthy'
  end,
  'observed',true,
  'scope','system',
  'summary',jsonb_build_object(
    'active_missions',active_missions,
    'blocked_missions',blocked_missions,
    'blocked_missions_total',blocked_missions_total,
    'blocked_missions_24h',blocked_missions,
    'failed_24h',failed_24h,
    'failed_24h_total',failed_24h_total,
    'suppressed_duplicate_recovery_failures_24h',suppressed_duplicate_recovery_failures_24h,
    'queued_jobs',queued_jobs,
    'running_jobs',running_jobs,
    'stale_jobs',stale_jobs,
    'devices_online',devices_online,
    'devices_total',devices_total,
    'models_available',models_available,
    'models_total',models_total
  ),
  'dependencies',jsonb_build_object(
    'device_transport',jsonb_build_object(
      'status',case when devices_online > 0 then 'healthy' else 'unavailable' end,
      'online',devices_online,'total',devices_total
    ),
    'model_runtime',jsonb_build_object(
      'status',case when models_available > 0 then 'healthy' else 'unavailable' end,
      'available',models_available,'total',models_total
    ),
    'job_queue',jsonb_build_object(
      'status',case when stale_jobs > 0 then 'degraded' else 'healthy' end,
      'queued',queued_jobs,'running',running_jobs,'stale',stale_jobs
    )
  ),
  'next_actions',
    case
      when stale_jobs > 0 then jsonb_build_array('Inspeccionar jobs stale y la evidencia del watchdog.')
      when blocked_missions > 0 then jsonb_build_array('Revisar las misiones bloqueadas durante las últimas 24 horas en el panel de diagnóstico.')
      when failed_24h > 0 then jsonb_build_array('Revisar la evidencia de los fallos de las últimas 24 horas y separar errores de ejecución de recuperaciones históricas.')
      when queued_jobs > 0 and devices_online = 0 then jsonb_build_array('Restaurar un executor de dispositivo online antes de esperar progreso.')
      else jsonb_build_array('No se requiere una acción operativa inmediata.')
    end
)
from stats;
$function$;


CREATE OR REPLACE FUNCTION aria_internal.aria_meditation_mission_status_counts_v1(p_user_id uuid, p_session_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
  with owned as materialized (
    select coalesce(m.status, 'unknown') as status, m.updated_at
      from aria_internal.mission_state m
     where p_user_id is not null
       and (
         m.metadata ->> 'user_id' = p_user_id::text
         or m.metadata ->> 'owner_user_id' = p_user_id::text
         or (
           nullif(btrim(p_session_id), '') is not null
           and m.metadata ->> 'meditation_session_id' = btrim(p_session_id)
         )
       )
  ),
  counts as (
    select status, count(*)::bigint as total
      from owned
     group by status
  ),
  recent_counts as (
    select status, count(*)::bigint as total
      from owned
     where updated_at >= clock_timestamp()-interval '24 hours'
     group by status
  )
  select jsonb_build_object(
    'total', (select count(*)::bigint from owned),
    'statuses', coalesce(
      (select jsonb_object_agg(status, total) from counts),
      '{}'::jsonb
    ),
    'recent_24h_total', (select count(*)::bigint from owned where updated_at >= clock_timestamp()-interval '24 hours'),
    'recent_24h_statuses', coalesce(
      (select jsonb_object_agg(status, total) from recent_counts),
      '{}'::jsonb
    )
  );
$function$;

