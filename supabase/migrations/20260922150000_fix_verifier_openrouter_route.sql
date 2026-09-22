-- Repair the verifier recovery route so its catalog resource is genuinely OpenRouter/free.
update aria_internal.agent_catalog
set model_id = 'nex-agi/nex-n2.5-pro:free',
    metadata = (
      coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'provider_id', 'openrouter',
        'account_id', 'acct_openrouter_primary',
        'free_route', true,
        'provider_lock', true,
        'live_verified', true,
        'migration_reason', 'correct verifier recovery route after repeated Google 429 quota exhaustion',
        'corrected_at', clock_timestamp()
      )
      - 'model_correction'
    )
where agent_id = 'aria-agent-verifier-openrouter-v1';
