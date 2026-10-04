create or replace function aria_internal.verify_proactive_digest_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','aria_internal'
as $$
select coalesce(
 (select jsonb_build_object(
   'present',true,
   'digest_id',d.digest_id,
   'engine_version',d.engine_version,
   'action_mode',d.action_mode,
   'fingerprint',d.fingerprint,
   'fingerprint_algorithm',d.fingerprint_algorithm,
   'recommendation_count',jsonb_array_length(d.digest->'recommendations')
 ) from aria_internal.proactive_digests d order by d.created_at desc limit 1),
 jsonb_build_object('present',false)
);
$$;