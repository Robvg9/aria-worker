-- Prevent direct external execution of the heavy stale-mission recovery body.
revoke all on function aria_internal.aria_autonomy_recover_stale_missions_v1(interval) from public;
revoke all on function aria_internal.aria_autonomy_recover_stale_missions_v1(interval) from anon;
revoke all on function aria_internal.aria_autonomy_recover_stale_missions_v1(interval) from authenticated;
revoke all on function aria_internal.aria_autonomy_recover_stale_missions_v1(interval) from service_role;
grant execute on function aria_internal.aria_autonomy_recover_stale_missions(interval) to service_role;
