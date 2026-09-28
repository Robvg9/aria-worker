begin;

alter function aria_internal.aria_autonomy_recover_stale_missions(interval)
  rename to aria_autonomy_recover_stale_missions_v1;

create or replace function aria_internal.aria_autonomy_recover_stale_missions(
  p_stale_after interval default '00:02:00'::interval
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
begin
  if extract(minute from clock_timestamp())::integer % 15 <> 0 then
    return 0;
  end if;

  return aria_internal.aria_autonomy_recover_stale_missions_v1(p_stale_after);
end;
$function$;

revoke all on function aria_internal.aria_autonomy_recover_stale_missions(interval) from public;
revoke all on function aria_internal.aria_autonomy_recover_stale_missions(interval) from anon;
revoke all on function aria_internal.aria_autonomy_recover_stale_missions(interval) from authenticated;
grant execute on function aria_internal.aria_autonomy_recover_stale_missions(interval) to service_role;

commit;