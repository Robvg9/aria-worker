-- XAI reachability reconciliation: adapter exists, but the physical credential is absent.
-- Keep the provider/model/account registered as non-selectable until a real credential is installed.
insert into aria_internal.provider_registry(
  provider_id,display_name,status,enabled,priority,integration_status,
  interface_types,interfaces,authentication_types,metadata,notes
) values (
  'xai','xAI','unavailable',false,0,'not_connected',
  '["api"]'::jsonb,
  '[{"interface_type":"api","interface_status":"not_configured","authentication_type":"api_key"}]'::jsonb,
  '["api_key"]'::jsonb,
  jsonb_build_object(
    'adapter_registered',true,
    'credential_present',false,
    'reachability_audit','credential_secret_not_found',
    'audited_at',clock_timestamp()
  ),
  'Adapter is registered in execution runtime, but no xAI credential exists in ARIA secret store; route is intentionally not selectable.'
)
on conflict(provider_id) do update set
  status=excluded.status,
  enabled=excluded.enabled,
  priority=excluded.priority,
  integration_status=excluded.integration_status,
  interface_types=excluded.interface_types,
  interfaces=excluded.interfaces,
  authentication_types=excluded.authentication_types,
  metadata=excluded.metadata,
  notes=excluded.notes,
  updated_at=clock_timestamp();

insert into aria_internal.account_registry(
  account_id,provider_id,display_name,status,enabled,credential_type,interface_type,
  account_kind,scope,models,capabilities,priority,quota,rate_limit,credential_ref,
  secret_present,metadata,notes
) values (
  'acct_xai_primary','xai','xAI primary','unavailable',false,'api_key','api','model',
  '["text_generation"]'::jsonb,
  '["xai/grok-4.6"]'::jsonb,
  '["text_generation"]'::jsonb,
  0,null,null,'secret://xai/acct_xai_primary',false,
  jsonb_build_object('adapter_registered',true,'credential_present',false,'reachability_audit','credential_secret_not_found','audited_at',clock_timestamp()),
  'Known account identity, but credential is absent; kept non-selectable until credential installation.'
)
on conflict(account_id) do update set
  status=excluded.status, enabled=excluded.enabled, credential_type=excluded.credential_type,
  interface_type=excluded.interface_type, scope=excluded.scope, models=excluded.models,
  capabilities=excluded.capabilities, priority=excluded.priority, credential_ref=excluded.credential_ref,
  secret_present=excluded.secret_present, metadata=excluded.metadata, notes=excluded.notes,
  updated_at=clock_timestamp();

insert into aria_internal.model_registry(
  model_id,display_name,provider_id,upstream_provider_id,status,enabled,integration_status,
  interface_type,model_family,context_window,output_limit,capabilities,pricing,n8n_evidence,metadata,notes
) values (
  'xai/grok-4.6','Grok 4.6 (xAI direct API)','xai','xai','unavailable',false,'not_connected',
  'api','grok-4.6',null,null,
  '["text_generation"]'::jsonb,'{}'::jsonb,'{}'::jsonb,
  jsonb_build_object('adapter_registered',true,'credential_present',false,'reachability_audit','credential_secret_not_found','audited_at',clock_timestamp()),
  'Adapter exists but live xAI credential is absent; model is intentionally not route-selectable.'
)
on conflict(model_id) do update set
  status=excluded.status, enabled=excluded.enabled, integration_status=excluded.integration_status,
  interface_type=excluded.interface_type, metadata=excluded.metadata, notes=excluded.notes,
  updated_at=clock_timestamp();

insert into aria_internal.quota_registry(
  quota_id,account_id,provider_id,model_id,status,
  limits_requests,limits_tokens_input,limits_tokens_output,limits_tokens_total,limits_period,
  usage_requests,usage_tokens_input,usage_tokens_output,usage_tokens_total,
  usage_period_start,usage_period_end,
  rate_limit_requests,rate_limit_tokens,rate_limit_window,
  source_type,evidence_ref,metadata,notes
) values (
  'quota_xai_primary_grok46','acct_xai_primary','xai','xai/grok-4.6','disabled',
  null,null,null,null,null,
  null,null,null,null,null,null,
  null,null,null,
  'execution','audit://2026-09-18/xai-credential-absence',
  jsonb_build_object('credential_present',false,'audited_at',clock_timestamp()),
  'Quota/capacity is disabled because the physical xAI credential is absent.'
)
on conflict(quota_id) do update set
  status=excluded.status,
  source_type=excluded.source_type,
  evidence_ref=excluded.evidence_ref,
  metadata=excluded.metadata,
  notes=excluded.notes,
  updated_at=clock_timestamp();
