-- Universal Execution hardening: lease-fenced mission wrappers are service-role only.
revoke execute on function public.aria_mission_renew_lease(text,text,interval) from public,anon,authenticated;
grant execute on function public.aria_mission_renew_lease(text,text,interval) to service_role;
revoke execute on function public.aria_mission_update_lease(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.aria_mission_update_lease(text,text,jsonb) to service_role;
revoke execute on function public.aria_mission_append_event_lease(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.aria_mission_append_event_lease(text,text,jsonb) to service_role;
revoke execute on function public."aria_internal.aria_mission_renew_lease"(text,text,interval) from public,anon,authenticated;
grant execute on function public."aria_internal.aria_mission_renew_lease"(text,text,interval) to service_role;
