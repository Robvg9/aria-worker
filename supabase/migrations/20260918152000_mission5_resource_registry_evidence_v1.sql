-- Mission 5/7: canonical resource graph + live evidence boundary
alter table aria_internal.agent_catalog
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function aria_internal.resolve_agent_resource(
  p_agent_id text,
  p_capability_id text default 'text_generation'
)
returns jsonb
language sql
security definer
set search_path = 'pg_catalog','aria_internal'
as $$
with candidates as (
  select
    a.agent_id,
    a.role,
    a.capabilities,
    a.scope,
    a.max_risk,
    a.status as agent_status,
    a.model_id,
    a.metadata as agent_metadata,
    m.display_name as model_name,
    m.provider_id,
    m.status as model_status,
    m.enabled as model_enabled,
    m.integration_status as model_integration_status,
    m.capabilities as model_capabilities,
    m.pricing as model_pricing,
    m.metadata as model_metadata,
    p.display_name as provider_name,
    p.status as provider_status,
    p.enabled as provider_enabled,
    p.integration_status as provider_integration_status,
    ac.account_id,
    ac.display_name as account_name,
    ac.status as account_status,
    ac.enabled as account_enabled,
    ac.credential_ref,
    ac.secret_present,
    ac.metadata as account_metadata,
    cm.status as capability_status,
    cm.evidence_type as capability_evidence_type,
    cm.evidence_ref as capability_evidence_ref,
    cm.verified_at as capability_verified_at,
    cm.metadata as capability_metadata,
    row_number() over (
      order by
        case when cm.status='verified' then 0 else 1 end,
        case when ac.secret_present then 0 else 1 end,
        case when m.integration_status='connected' then 0 else 1 end,
        ac.priority desc,
        m.model_id
    ) as rn
  from aria_internal.agent_catalog a
  join aria_internal.model_registry m
    on m.model_id = a.model_id
  join aria_internal.provider_registry p
    on p.provider_id = m.provider_id
  left join lateral (
    select x.*
    from aria_internal.account_registry x
    where x.provider_id=m.provider_id
      and x.status in ('available','degraded')
      and x.enabled=true
      and x.secret_present=true
      and x.models ? m.model_id
    order by x.priority desc, x.account_id
    limit 1
  ) ac on true
  left join aria_internal.capability_matrix cm
    on cm.model_id=m.model_id
   and cm.capability_id=p_capability_id
  where a.agent_id=p_agent_id
    and a.status='available'
    and a.scope ? 'reason'
)
select jsonb_build_object(
  'status',
    case
      when agent_id is null then 'blocked'
      when model_status not in ('available','degraded') or not model_enabled then 'blocked'
      when provider_status not in ('available','degraded') or not provider_enabled then 'blocked'
      when provider_integration_status in ('not_connected','unknown') then 'blocked'
      when account_id is null or account_status not in ('available','degraded') or not account_enabled or not secret_present then 'blocked'
      when capability_status <> 'verified' then 'blocked'
      else 'ready'
    end,
  'reason',
    case
      when agent_id is null then 'agent_not_found_or_unavailable'
      when model_status not in ('available','degraded') or not model_enabled then 'model_unavailable'
      when provider_status not in ('available','degraded') or not provider_enabled then 'provider_unavailable'
      when provider_integration_status in ('not_connected','unknown') then 'provider_not_connected'
      when account_id is null then 'account_missing_or_model_not_scoped'
      when account_status not in ('available','degraded') or not account_enabled then 'account_unavailable'
      when not secret_present then 'credential_not_present'
      when capability_status <> 'verified' then 'capability_not_verified'
      else 'ready'
    end,
  'agent', jsonb_build_object(
    'agent_id',agent_id,'role',role,'capabilities',capabilities,'scope',scope,
    'max_risk',max_risk,'status',agent_status,'metadata',coalesce(agent_metadata,'{}'::jsonb)
  ),
  'provider', jsonb_build_object(
    'provider_id',provider_id,'display_name',provider_name,'status',provider_status,
    'enabled',provider_enabled,'integration_status',provider_integration_status
  ),
  'account', jsonb_build_object(
    'account_id',account_id,'display_name',account_name,'status',account_status,
    'enabled',account_enabled,'credential_ref',credential_ref,
    'secret_present',secret_present,'metadata',coalesce(account_metadata,'{}'::jsonb)
  ),
  'model', jsonb_build_object(
    'model_id',model_id,'display_name',model_name,'status',model_status,
    'enabled',model_enabled,'integration_status',model_integration_status,
    'capabilities',model_capabilities,'pricing',coalesce(model_pricing,'{}'::jsonb),
    'metadata',coalesce(model_metadata,'{}'::jsonb)
  ),
  'capability', jsonb_build_object(
    'capability_id',p_capability_id,'status',capability_status,
    'evidence_type',capability_evidence_type,'evidence_ref',capability_evidence_ref,
    'verified_at',capability_verified_at,'metadata',coalesce(capability_metadata,'{}'::jsonb)
  )
)
from candidates
where rn=1;
$$;

revoke all on function aria_internal.resolve_agent_resource(text,text) from public, anon, authenticated;
grant execute on function aria_internal.resolve_agent_resource(text,text) to service_role;

insert into aria_internal.agent_catalog
(agent_id,role,capabilities,scope,max_risk,status,model_id,metadata)
values
(
 'aria-agent-planner-gemini35-v1',
 'planner',
 '["planning","decomposition","text_generation"]'::jsonb,
 '["read","reason"]'::jsonb,
 'medium',
 'available',
 'google/gemini-3.5-flash-lite-direct',
 '{"mission5":true,"specialization":"planner","provider_id":"google","account_id":"acct_google_gemini_free","capability_ids":["text_generation"],"live_evidence":null}'::jsonb
),
(
 'aria-agent-verifier-gemini35-v1',
 'verifier',
 '["verification","review","text_generation"]'::jsonb,
 '["read","reason"]'::jsonb,
 'medium',
 'available',
 'google/gemini-3.5-flash-lite-direct',
 '{"mission5":true,"specialization":"verifier","provider_id":"google","account_id":"acct_google_gemini_free","capability_ids":["text_generation"],"live_evidence":null}'::jsonb
)
on conflict (agent_id) do update
set role=excluded.role,
    capabilities=excluded.capabilities,
    scope=excluded.scope,
    max_risk=excluded.max_risk,
    status=excluded.status,
    model_id=excluded.model_id,
    metadata=aria_internal.agent_catalog.metadata || excluded.metadata,
    updated_at=clock_timestamp();

update aria_internal.agent_catalog
set model_id='google/gemini-3.5-flash-lite-direct',
    metadata = metadata || jsonb_build_object(
      'mission5',true,
      'provider_id','google',
      'account_id','acct_google_gemini_free',
      'capability_ids',jsonb_build_array('text_generation'),
      'migration_reason','bind agents to currently verified direct model'
    ),
    updated_at=clock_timestamp()
where status='available';

update aria_internal.model_registry
set metadata = metadata || jsonb_build_object(
  'mission5_verified',true,
  'credential_chain_provider','google',
  'credential_chain_account','acct_google_gemini_free',
  'capability_verified',true
),
updated_at=clock_timestamp()
where model_id='google/gemini-3.5-flash-lite-direct';

update aria_internal.capability_matrix
set notes=coalesce(notes,'') || case when notes like '%Mission5 canonical resource graph%' then '' else ' Mission5 canonical resource graph.' end,
    metadata=metadata || jsonb_build_object('mission5_registry_ready',true),
    updated_at=clock_timestamp()
where model_id='google/gemini-3.5-flash-lite-direct'
  and capability_id='text_generation'
  and status='verified';
