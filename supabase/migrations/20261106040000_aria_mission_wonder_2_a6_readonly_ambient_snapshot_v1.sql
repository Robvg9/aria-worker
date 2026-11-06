-- Mission Wonder 2 / Step 6 A6: read-only ambient baseline/reconciliation RPC.
-- This migration creates no A6 scope, mission, job, lease, event, or worker permission.
-- Installation is deliberately excluded from automatic production deployments.

begin;

create or replace function public.aria_m22_a6_ambient_snapshot_v1(p_scope_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal','public'
as $function$
declare
  v_role text;
  v_legacy_count bigint;
  v_legacy_fingerprint text;
  v_non_a6_active_jobs bigint;
  v_non_a6_active_jobs_fingerprint text;
  v_cron48 boolean;
  v_cron49 boolean;
  v_cron50 boolean;
  v_active_a6_missions bigint;
  v_active_a6_jobs bigint;
begin
  v_role := coalesce(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  if v_role <> 'service_role' then
    raise exception 'a6_ambient_snapshot_service_role_required' using errcode='42501';
  end if;

  if coalesce(p_scope_id,'') !~ '^mission_wonder_2_a6_[a-z0-9_-]{6,100}$' then
    raise exception 'a6_ambient_snapshot_scope_id_invalid' using errcode='22023';
  end if;

  select count(*),
         md5(coalesce(string_agg(
           concat_ws('|',m.mission_id,m.status,m.updated_at::text,
             coalesce(m.next_action,''),coalesce(m.lease_owner,''),
             coalesce(m.lease_until::text,'')),
           E'\n' order by m.mission_id
         ),''))
    into v_legacy_count,v_legacy_fingerprint
  from aria_internal.mission_state m
  where m.status in ('planning','queued','running','waiting')
    and m.metadata->>'mission_wonder_2_a6_scope_id' is distinct from p_scope_id;

  select count(*),
         md5(coalesce(string_agg(
           concat_ws('|',j.job_id,j.mission_id,j.status,j.updated_at::text,
             coalesce(j.lease_owner,''),coalesce(j.lease_until::text,'')),
           E'\n' order by j.job_id
         ),''))
    into v_non_a6_active_jobs,v_non_a6_active_jobs_fingerprint
  from aria_internal.execution_jobs j
  where j.status in ('queued','claimed','running')
    and not exists (
      select 1 from aria_internal.mission_state m
      where m.mission_id=j.mission_id
        and m.metadata->>'mission_wonder_2_a6_scope_id'=p_scope_id
    );

  select case when count(*)=1 then bool_or(c.active) else null end
    into v_cron48 from cron.job c where c.jobid=48;
  select case when count(*)=1 then bool_or(c.active) else null end
    into v_cron49 from cron.job c where c.jobid=49;
  select case when count(*)=1 then bool_or(c.active) else null end
    into v_cron50 from cron.job c where c.jobid=50;

  select count(*) into v_active_a6_missions
  from aria_internal.mission_state m
  where m.metadata->>'mission_wonder_2_a6_scope_id'=p_scope_id
    and m.status in ('planning','queued','running','waiting');

  select count(*) into v_active_a6_jobs
  from aria_internal.execution_jobs j
  join aria_internal.mission_state m on m.mission_id=j.mission_id
  where m.metadata->>'mission_wonder_2_a6_scope_id'=p_scope_id
    and j.status in ('queued','claimed','running');

  return jsonb_build_object(
    'schemaVersion','mission-wonder-2-a6-ambient-snapshot-v1',
    'scopeId',p_scope_id,
    'snapshotAt',clock_timestamp(),
    'legacyNonterminalMissionCount',v_legacy_count,
    'legacyNonterminalMissionFingerprint',v_legacy_fingerprint,
    'nonA6ActiveJobCount',v_non_a6_active_jobs,
    'nonA6ActiveJobFingerprint',v_non_a6_active_jobs_fingerprint,
    'cron48Active',v_cron48,
    'cron49Active',v_cron49,
    'cron50Active',v_cron50,
    'activeA6MissionCount',v_active_a6_missions,
    'activeA6JobCount',v_active_a6_jobs,
    'missionExecutionPaused','NOT_VERIFIED_BY_DATABASE'
  );
end;
$function$;

revoke all on function public.aria_m22_a6_ambient_snapshot_v1(text) from public,anon,authenticated;
grant execute on function public.aria_m22_a6_ambient_snapshot_v1(text) to service_role;

commit;
