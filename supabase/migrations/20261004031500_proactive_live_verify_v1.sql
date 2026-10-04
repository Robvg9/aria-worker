-- ARIA Proactive Intelligence LIVE verification helper v1
create or replace function aria_internal.verify_proactive_digest_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','aria_internal'
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'present',true,
        'digest_id',d.digest_id,
        'engine_version',d.engine_version,
        'action_mode',d.action_mode,
        'observed_at',d.observed_at,
        'fingerprint',d.fingerprint,
        'recommendation_count',jsonb_array_length(d.digest->'recommendations'),
        'source_refs',d.source_refs
      )
      from aria_internal.proactive_digests d
      order by d.created_at desc
      limit 1
    ),
    jsonb_build_object('present',false)
  );
$$;

revoke execute on function aria_internal.verify_proactive_digest_v1() from public, anon, authenticated;
grant execute on function aria_internal.verify_proactive_digest_v1() to service_role;
