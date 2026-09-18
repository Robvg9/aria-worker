-- Mission 6: intelligent router v2, governed fallback, parallel selection evidence
create table if not exists aria_internal.router_decisions (
  decision_id text primary key,
  trace_id text,
  task text not null,
  capability_id text not null,
  complexity text not null,
  selected jsonb,
  fallback jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  candidates_considered integer not null default 0,
  rejected jsonb not null default '[]'::jsonb,
  parallel_plan jsonb,
  created_at timestamptz not null default now()
);
alter table aria_internal.router_decisions enable row level security;
revoke all on aria_internal.router_decisions from public, anon, authenticated;
grant select, insert, update, delete on aria_internal.router_decisions to service_role;

create or replace function aria_internal.router_live_snapshot()
returns jsonb language sql security definer set search_path=aria_internal as $$
with models as (
 select m.*, cm.capability_id,
   ar.account_id, ar.status account_status, ar.enabled account_enabled,
   qr.status quota_status,
   coalesce((qr.metadata->>'rate_limit_status'), case when qr.rate_limit_requests is null then 'unknown' else 'available' end) rate_limit_status,
   (coalesce((m.metadata->>'live_verified')::boolean,false) or coalesce((m.metadata->>'mission5_live_verified')::boolean,false)) live_verified,
   ag.agents, coalesce(obs.attempts,0) attempts, coalesce(obs.successes,0) successes, obs.avg_latency_ms
 from aria_internal.model_registry m
 join aria_internal.capability_matrix cm on cm.model_id=m.model_id and cm.capability_id='text_generation' and cm.status='verified'
 join aria_internal.account_registry ar on ar.provider_id=m.provider_id and ar.status='available' and ar.enabled=true and ar.models @> jsonb_build_array(m.model_id)
 left join lateral (
   select q.status,q.metadata,q.rate_limit_requests
   from aria_internal.quota_registry q
   where q.account_id=ar.account_id and (q.model_id=m.model_id or q.model_id is null)
   order by (q.model_id=m.model_id) desc,q.updated_at desc limit 1
 ) qr on true
 left join lateral (
   select jsonb_agg(jsonb_build_object('agent_id',a.agent_id,'role',a.role,'capabilities',a.capabilities,'scope',a.scope,'max_risk',a.max_risk,'status',a.status,'model_id',a.model_id,'metadata',a.metadata) order by a.agent_id) agents
   from aria_internal.agent_catalog a
   where a.model_id=m.model_id and a.status='available'
 ) ag on true
 left join lateral (
   select count(*)::int attempts, count(*) filter (where j.status='succeeded')::int successes,
          avg(extract(epoch from (j.completed_at-j.started_at))*1000) filter (where j.completed_at is not null and j.started_at is not null) avg_latency_ms
   from aria_internal.execution_jobs j
   where coalesce(j.metadata->>'model_id',j.result#>>'{response,provider_model}')=m.model_id
     and j.status in ('succeeded','failed') and j.requested_at > now()-interval '30 days'
 ) obs on true
 where m.status='available' and m.enabled=true
)
select jsonb_build_object('version','aria-intelligent-router-v2.0.0','generated_at',now(),'candidates',coalesce(jsonb_agg(to_jsonb(models) order by models.provider_id,models.model_id),'[]'::jsonb))
from models;
$$;

revoke all on function aria_internal.router_live_snapshot() from public, anon, authenticated;
grant execute on function aria_internal.router_live_snapshot() to service_role;

create or replace function aria_internal.record_router_decision(p_decision jsonb)
returns jsonb language plpgsql security definer set search_path=aria_internal as $$
declare d text:=coalesce(p_decision->>'decision_id','router_'||replace(gen_random_uuid()::text,'-',''));
begin
 insert into aria_internal.router_decisions(decision_id,trace_id,task,capability_id,complexity,selected,fallback,evidence,candidates_considered,rejected,parallel_plan)
 values(d,p_decision->>'trace_id',coalesce(p_decision->>'task',''),coalesce(p_decision->>'capability_id','text_generation'),coalesce(p_decision->>'complexity','low'),p_decision->'selected',coalesce(p_decision->'fallback','[]'::jsonb),coalesce(p_decision->'evidence','{}'::jsonb),coalesce((p_decision->>'candidates_considered')::int,0),coalesce(p_decision->'rejected','[]'::jsonb),p_decision->'parallel_plan')
 on conflict (decision_id) do nothing;
 return jsonb_build_object('decision_id',d,'recorded',true);
end;
$$;
revoke all on function aria_internal.record_router_decision(jsonb) from public, anon, authenticated;
grant execute on function aria_internal.record_router_decision(jsonb) to service_role;
