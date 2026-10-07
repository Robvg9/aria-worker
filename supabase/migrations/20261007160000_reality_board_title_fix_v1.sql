UPDATE aria_internal.mission_state
SET metadata = jsonb_set(
  coalesce(metadata,'{}'::jsonb),
  '{display_title}',
  to_jsonb('ARIA Reality Board'::text),
  true
),
updated_at=clock_timestamp()
WHERE mission_id='mission_d0bb5430-bbe7-423a-aecf-e985eb1dcf5d'
  AND goal ~* 'reality\s+board'
  AND coalesce(metadata->>'display_title','')='Integración con BattleCruiser';
