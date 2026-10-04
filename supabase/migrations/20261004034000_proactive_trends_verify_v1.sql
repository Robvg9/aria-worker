create or replace function aria_internal.verify_proactive_trends_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','aria_internal'
as $$
select coalesce(
 (select jsonb_build_object(
   'present',true,'trend_id',t.trend_id,'engine_version',t.engine_version,
   'action_mode',t.action_mode,'fingerprint',t.fingerprint,
   'trend_count',t.trend_count,'persistent_count',t.persistent_count,
   'recurring_count',t.recurring_count,'new_count',t.new_count
  ) from aria_internal.proactive_trends t order by t.created_at desc limit 1),
 jsonb_build_object('present',false)
);
$$;
revoke execute on function aria_internal.verify_proactive_trends_v1() from public,anon,authenticated;
grant execute on function aria_internal.verify_proactive_trends_v1() to service_role;