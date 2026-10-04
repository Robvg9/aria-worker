create or replace function aria_internal.refresh_proactive_trends_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal','public'
as $$
declare n timestamptz:=now(); s timestamptz:=n-interval '7 days'; rows jsonb; tc int:=0; pc int:=0; rc int:=0; nc int:=0; fp text; id text;
begin
with x as (
 select d.digest_id,d.observed_at,r->>'id' rid,r->>'kind' rkind,r->>'fingerprint' rfp
 from aria_internal.proactive_digests d cross join lateral jsonb_array_elements(coalesce(d.digest->'recommendations','[]'::jsonb)) r
 where d.observed_at between s and n
), g as (
 select rkind,rfp,rid,count(distinct digest_id)::int occ,min(observed_at) first_at,max(observed_at) last_at,array_agg(distinct digest_id order by digest_id) ids
 from x group by rkind,rfp,rid
), b as (
 select jsonb_build_object(
  'trend_id','trend_'||left(encode(digest(convert_to(coalesce(rkind,'unknown')||'|'||coalesce(rfp,'')||'|'||coalesce(rid,''),'utf8'),'sha256'),'hex'),24),
  'version','aria-proactive-trend-intelligence-v1.0.0','action_mode','recommendation_only','kind','recommendation_trend',
  'state',case when occ>=3 then 'persistent' when occ=2 then 'recurring' else 'new' end,
  'recommendation_kind',rkind,'recommendation_fingerprint',rfp,'recommendation_id',rid,'occurrence_count',occ,
  'first_observed_at',first_at,'last_observed_at',last_at,'span_ms',extract(epoch from (last_at-first_at))*1000,'digest_ids',to_jsonb(ids)
 ) item,occ from g
)
select coalesce(jsonb_agg(item),'[]'::jsonb),count(*)::int,count(*) filter(where occ>=3)::int,count(*) filter(where occ=2)::int,count(*) filter(where occ=1)::int
into rows,tc,pc,rc,nc from b;
fp:=encode(digest(convert_to(jsonb_build_object('engine_version','aria-proactive-trend-intelligence-v1.0.0','window_start',s,'window_end',n,'trends',rows)::text,'utf8'),'sha256'),'hex');
id:='proactive_trend_live_'||left(fp,32);
insert into aria_internal.proactive_trends(trend_id,engine_version,action_mode,generated_at,window_start,window_end,fingerprint,fingerprint_algorithm,trend_count,persistent_count,recurring_count,new_count,trends,source_refs)
values(id,'aria-proactive-trend-intelligence-v1.0.0','recommendation_only',n,s,n,fp,'sha256',tc,pc,rc,nc,rows,jsonb_build_array('aria_internal.proactive_digests'))
on conflict(trend_id) do nothing;
return jsonb_build_object('ok',true,'live',true,'persisted',true,'engine_version','aria-proactive-trend-intelligence-v1.0.0','action_mode','recommendation_only',
 'trend_id',id,'fingerprint',fp,'fingerprint_algorithm','sha256','generated_at',n,'trend_count',tc,'persistent_count',pc,'recurring_count',rc,'new_count',nc,'trends',rows);
end; $$;