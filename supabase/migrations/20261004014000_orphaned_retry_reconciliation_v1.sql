-- ARIA: reconcile retrying RUNNING missions that have lost their lease.
-- A RUNNING mission without a lease is not live execution; after a grace period
-- it becomes a governed failure/replan candidate instead of looping forever.
create or replace function aria_internal.aria_reconcile_orphaned_retry_missions(
  p_stale_after interval default '00:10:00'::interval
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  n integer := 0;
begin
  update aria_internal.mission_state m
     set status='failed',
         lease_owner=null,
         lease_until=null,
         current_step=0,
         completed_steps=0,
         attempt_count=0,
         next_action='replan: stale unleased retry reconciled',
         last_stderr='stale_unleased_retry_reconciled',
         recovery_count=coalesce(m.recovery_count,0)+1,
         last_recovery_reason='stale_unleased_retry_reconciled',
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
   where m.status='running'
     and m.lease_owner is null
     and m.lease_until is null
     and m.updated_at < clock_timestamp()-p_stale_after
     and coalesce(m.checkpoint->'recovery'->>'status','')='retry_scheduled';

  get diagnostics n=row_count;
  return n;
end;
$function$;

create or replace function aria_internal.aria_autonomy_recover_stale_missions_v1(
  p_stale_after interval default '00:02:00'::interval
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  n_orphan integer := 0;
  n_heavy integer := 0;
begin
  if extract(minute from clock_timestamp())::integer % 15 <> 0 then
    return 0;
  end if;

  n_orphan := aria_internal.aria_reconcile_orphaned_retry_missions(p_stale_after);
  n_heavy := aria_internal.aria_autonomy_recover_stale_missions_heavy_v1(p_stale_after);
  return n_orphan+n_heavy;
end;
$function$;