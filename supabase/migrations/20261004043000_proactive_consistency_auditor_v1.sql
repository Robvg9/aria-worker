create or replace function aria_internal.audit_proactive_consistency_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','aria_internal','public'
as $$
with latest as (
  select trend_id,engine_version,action_mode,fingerprint,fingerprint_algorithm,trend_count,persistent_count,recurring_count,new_count,trends
  from aria_internal.proactive_trends
  order by created_at desc
  limit 1
),
source_ids as (
  select distinct d.digest_id
  from aria_internal.proactive_digests d
  where d.observed_at >= now()-interval '7 days'
),
checks as (
  select
    l.trend_id,
    t->>'trend_id' as trend_row_id,
    coalesce((t->>'occurrence_count')::int,0) as occurrence_count,
    jsonb_array_length(coalesce(t->'digest_ids','[]'::jsonb)) as digest_id_count,
    (select count(*) from jsonb_array_elements_text(coalesce(t->'digest_ids','[]'::jsonb)) x(value) where x.value not in (select digest_id from source_ids)) as missing_source_count
  from latest l
  cross join lateral jsonb_array_elements(coalesce(l.trends,'[]'::jsonb)) t
),
summary as (
  select
    coalesce((select trend_id from latest),'') trend_id,
    coalesce((select trend_count from latest),0) declared_trend_count,
    coalesce((select persistent_count from latest),0) declared_persistent_count,
    coalesce((select recurring_count from latest),0) declared_recurring_count,
    coalesce((select new_count from latest),0) declared_new_count,
    count(*) actual_trend_count,
    count(*) filter(where t->>'state'='persistent') actual_persistent_count,
    count(*) filter(where t->>'state'='recurring') actual_recurring_count,
    count(*) filter(where t->>'state'='new') actual_new_count,
    count(*) filter(where occurrence_count <> digest_id_count or missing_source_count > 0) source_findings
  from checks c cross join lateral jsonb_array_elements(coalesce((select trends from latest),'[]'::jsonb)) t
)
select jsonb_build_object(
  'ok',true,
  'live',true,
  'read_only',true,
  'status',case when declared_trend_count<>actual_trend_count
    or declared_persistent_count<>actual_persistent_count
    or declared_recurring_count<>actual_recurring_count
    or declared_new_count<>actual_new_count
    or source_findings>0 then 'drift' else 'consistent' end,
  'engine_version','aria-proactive-consistency-auditor-v1.0.0',
  'action_mode','recommendation_only',
  'trend_id',trend_id,
  'declared',jsonb_build_object(
    'trend_count',declared_trend_count,'persistent_count',declared_persistent_count,
    'recurring_count',declared_recurring_count,'new_count',declared_new_count
  ),
  'recomputed',jsonb_build_object(
    'trend_count',actual_trend_count,'persistent_count',actual_persistent_count,
    'recurring_count',actual_recurring_count,'new_count',actual_new_count
  ),
  'source_findings',source_findings,
  'fingerprint_algorithm',coalesce((select fingerprint_algorithm from latest),'unknown')
)
from summary;
$$;
revoke execute on function aria_internal.audit_proactive_consistency_v1() from public,anon,authenticated;
grant execute on function aria_internal.audit_proactive_consistency_v1() to service_role;