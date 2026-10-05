begin;

update aria_internal.model_registry as m
set
  status = 'available',
  enabled = true,
  metadata = coalesce(m.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'live_verified', true,
      'live_probe', 'aria-gemini-direct-live-check-v1',
      'live_probe_verification', true,
      'live_probe_latency_ms', 2205,
      'drift_reconciled_at', clock_timestamp()
    ),
  updated_at = clock_timestamp()
where m.model_id = 'google/gemini-3.5-flash-lite-direct'
  and exists (
    select 1
    from aria_internal.provider_registry p
    where p.provider_id = 'google'
      and p.enabled = true
      and p.status = 'available'
      and p.integration_status = 'connected'
  )
  and exists (
    select 1
    from aria_internal.capability_matrix c
    where c.model_id = m.model_id
      and c.capability_id = 'text_generation'
      and c.status = 'verified'
  );

insert into aria_internal.router_decisions (
  decision_id,
  trace_id,
  task,
  capability_id,
  complexity,
  selected,
  fallback,
  evidence,
  candidates_considered,
  rejected,
  parallel_plan,
  created_at
)
values (
  'router-cert-gemini-direct-20261005-001',
  'gemini-direct-live-check-20261005-001',
  'Fresh live certification of Google Gemini Direct operational route',
  'text_generation',
  'low',
  jsonb_build_object(
    'agent_id', null,
    'model_id', 'google/gemini-3.5-flash-lite-direct',
    'account_id', 'acct_google_gemini_free',
    'agent_role', null,
    'capability', 'text_generation',
    'provider_id', 'google'
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'live_verified', true,
    'verification', true,
    'provider', 'google',
    'route', 'direct',
    'model', 'google/gemini-3.5-flash-lite-direct',
    'upstream_model', 'gemini-3.5-flash-lite',
    'latency_ms', 2205,
    'usage', jsonb_build_object(
      'prompt_tokens', 15,
      'completion_tokens', 10,
      'total_tokens', 25
    ),
    'source', 'aria-gemini-direct-live-check-v1'
  ),
  1,
  '[]'::jsonb,
  null,
  clock_timestamp()
)
on conflict (decision_id) do nothing;

commit;
