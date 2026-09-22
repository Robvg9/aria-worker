-- Use the verified Google Gemini Lite route for the core reasoning agents
-- after the Gemini 3.5 Flash and OpenRouter free daily quotas were exhausted.
update aria_internal.agent_catalog
set model_id = 'google/gemini-3.5-flash-lite-direct',
    metadata = (
      coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'provider_id', 'google',
        'account_id', 'acct_google_gemini_free',
        'free_route', true,
        'provider_lock', true,
        'live_verified', true,
        'migration_reason', 'use verified Gemini Lite route after provider quota exhaustion',
        'corrected_at', clock_timestamp()
      )
      - 'model_correction'
    )
where agent_id in (
  'aria-agent-reviewer-v1',
  'aria-agent-coding-v1',
  'aria-agent-verifier-openrouter-v1'
);
