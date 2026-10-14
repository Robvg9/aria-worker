-- Authenticated, server-to-server probes for the four internally gated memory routes.
-- The cron token is read and used only inside PostgreSQL/Vault; it is never returned or written to evidence.

BEGIN;

CREATE TABLE IF NOT EXISTS aria_internal.aria_encrypt_step5_http_probe_evidence (
  probe_id uuid NOT NULL,
  route_slug text NOT NULL,
  request_id bigint NOT NULL UNIQUE,
  expected_status_code integer NOT NULL DEFAULT 503 CHECK (expected_status_code = 503),
  status_code integer,
  response_body jsonb,
  passed boolean,
  requested_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  PRIMARY KEY (probe_id, route_slug)
);

REVOKE ALL PRIVILEGES ON TABLE aria_internal.aria_encrypt_step5_http_probe_evidence
  FROM PUBLIC, anon, authenticated;

DO $authenticated_http_probes$
DECLARE
  v_probe_id uuid := gen_random_uuid();
  v_marker text := 'ariaencryptstep5' || replace(gen_random_uuid()::text,'-','');
  v_cron_token text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO v_cron_token
    FROM vault.decrypted_secrets
   WHERE name = 'aria_autonomy_cron_token'
   LIMIT 1;

  IF v_cron_token IS NULL OR length(v_cron_token) = 0 THEN
    RAISE EXCEPTION 'E2E_BLOCKED: cron token missing from Supabase Vault';
  END IF;

  v_request_id := net.http_post(
    'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-memory-v2',
    jsonb_build_object('action','search','query',v_marker),
    '{}'::jsonb,
    jsonb_build_object('content-type','application/json','x-aria-autonomy-token',v_cron_token),
    15000
  );
  INSERT INTO aria_internal.aria_encrypt_step5_http_probe_evidence(probe_id,route_slug,request_id)
  VALUES (v_probe_id,'aria-memory-v2',v_request_id);

  v_request_id := net.http_post(
    'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-learning-v2',
    jsonb_build_object('mission_id',v_marker),
    '{}'::jsonb,
    jsonb_build_object('content-type','application/json','x-aria-autonomy-token',v_cron_token),
    15000
  );
  INSERT INTO aria_internal.aria_encrypt_step5_http_probe_evidence(probe_id,route_slug,request_id)
  VALUES (v_probe_id,'aria-learning-v2',v_request_id);

  v_request_id := net.http_post(
    'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-learning-v3',
    jsonb_build_object('mission_id',v_marker),
    '{}'::jsonb,
    jsonb_build_object('content-type','application/json','x-aria-autonomy-token',v_cron_token),
    15000
  );
  INSERT INTO aria_internal.aria_encrypt_step5_http_probe_evidence(probe_id,route_slug,request_id)
  VALUES (v_probe_id,'aria-learning-v3',v_request_id);

  v_request_id := net.http_post(
    'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-learning-consolidator-v1',
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('content-type','application/json','x-aria-autonomy-token',v_cron_token),
    15000
  );
  INSERT INTO aria_internal.aria_encrypt_step5_http_probe_evidence(probe_id,route_slug,request_id)
  VALUES (v_probe_id,'aria-learning-consolidator-v1',v_request_id);
END
$authenticated_http_probes$;

COMMIT;
