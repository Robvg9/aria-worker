update aria_internal.model_registry
set status='unavailable',
    metadata=metadata || jsonb_build_object(
      'mission5_live_probe','2026-09-18',
      'live_probe_status',402,
      'live_probe_reason','openrouter_insufficient_credits',
      'last_probe_evidence','device-gateway:windows-fe722cc6681e4f9c9cc35f5ebbb0a089',
      'routable',false
    ),
    updated_at=clock_timestamp()
where model_id='google/gemini-2.5-flash-lite';

update aria_internal.capability_matrix
set status='unknown',
    evidence_type='provider_error',
    evidence_ref='device-gateway://mission5:model-probe:google/gemini-2.5-flash-lite',
    notes='LIVE 2026-09-18 provider returned HTTP 402 insufficient credits; route is fail-closed until real account capacity exists.',
    metadata=metadata || jsonb_build_object('mission5_live_probe',true,'routable',false),
    updated_at=clock_timestamp()
where model_id='google/gemini-2.5-flash-lite'
  and capability_id='text_generation';
