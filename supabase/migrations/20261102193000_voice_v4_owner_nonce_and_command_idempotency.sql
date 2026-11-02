-- ARIA Voice V4 — atomic owner-session nonce and direct-command idempotency.
-- Separate from execution_jobs: these records never create mission or job work.

BEGIN;

CREATE TABLE IF NOT EXISTS aria_internal.voice_owner_session_nonces (
  owner_user_id uuid NOT NULL,
  nonce text NOT NULL,
  device_id text NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_owner_session_nonces_pk PRIMARY KEY (owner_user_id, nonce),
  CONSTRAINT voice_owner_session_nonce_format CHECK (
    length(nonce) BETWEEN 24 AND 160
    AND nonce ~ '^[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT voice_owner_session_device_format CHECK (length(device_id) BETWEEN 4 AND 160),
  CONSTRAINT voice_owner_session_session_format CHECK (length(session_id) BETWEEN 8 AND 128),
  CONSTRAINT voice_owner_session_request_format CHECK (length(request_id) BETWEEN 8 AND 128)
);

CREATE INDEX IF NOT EXISTS voice_owner_session_nonces_expiry_idx
  ON aria_internal.voice_owner_session_nonces (expires_at);

CREATE TABLE IF NOT EXISTS aria_internal.voice_command_idempotency (
  owner_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_id text NOT NULL,
  device_id text,
  operation text NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_command_idempotency_pk PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT voice_command_idempotency_key_format CHECK (
    length(idempotency_key) BETWEEN 16 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT voice_command_idempotency_request_format CHECK (length(request_id) BETWEEN 8 AND 128),
  CONSTRAINT voice_command_idempotency_operation_allowed CHECK (
    operation IN (
      'aria.status',
      'device.status',
      'display.brightness.set',
      'app.open',
      'browser.open_url'
    )
  ),
  CONSTRAINT voice_command_idempotency_device_required CHECK (
    (operation = 'aria.status' AND device_id IS NULL)
    OR (operation <> 'aria.status' AND device_id IS NOT NULL AND length(device_id) BETWEEN 4 AND 160)
  )
);

CREATE INDEX IF NOT EXISTS voice_command_idempotency_expiry_idx
  ON aria_internal.voice_command_idempotency (expires_at);

COMMENT ON TABLE aria_internal.voice_owner_session_nonces IS
  'Single-use nonces for signed, short-lived ARIA owner sessions. Service-role RPC only; no audio or biometric template is stored.';
COMMENT ON TABLE aria_internal.voice_command_idempotency IS
  'Atomic deduplication for direct READ and allowlisted DEVICE ACTION commands across devices. No mission_id, job_id, shell, message body or audio is stored.';

CREATE OR REPLACE FUNCTION aria_internal.consume_voice_owner_session_nonce(
  p_owner_user_id uuid,
  p_device_id text,
  p_session_id text,
  p_request_id text,
  p_nonce text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  inserted_count integer;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 4 AND 160
     OR p_session_id IS NULL OR length(p_session_id) NOT BETWEEN 8 AND 128
     OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 8 AND 128
     OR p_nonce IS NULL OR length(p_nonce) NOT BETWEEN 24 AND 160
     OR p_nonce !~ '^[A-Za-z0-9_-]+$'
     OR p_expires_at IS NULL
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '30 seconds' THEN
    RAISE EXCEPTION 'invalid voice owner session nonce request';
  END IF;

  DELETE FROM aria_internal.voice_owner_session_nonces
  WHERE expires_at <= now();

  INSERT INTO aria_internal.voice_owner_session_nonces (
    owner_user_id, nonce, device_id, session_id, request_id, expires_at
  ) VALUES (
    p_owner_user_id, p_nonce, p_device_id, p_session_id, p_request_id, p_expires_at
  )
  ON CONFLICT (owner_user_id, nonce) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.claim_voice_command_idempotency(
  p_owner_user_id uuid,
  p_idempotency_key text,
  p_request_id text,
  p_device_id text,
  p_operation text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  inserted_count integer;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 128
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
     OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 8 AND 128
     OR p_operation IS NULL
     OR p_operation NOT IN (
       'aria.status',
       'device.status',
       'display.brightness.set',
       'app.open',
       'browser.open_url'
     )
     OR (p_operation = 'aria.status' AND p_device_id IS NOT NULL)
     OR (p_operation <> 'aria.status' AND (p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 4 AND 160))
     OR p_expires_at IS NULL
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '30 seconds' THEN
    RAISE EXCEPTION 'invalid voice command idempotency request';
  END IF;

  DELETE FROM aria_internal.voice_command_idempotency
  WHERE expires_at <= now();

  INSERT INTO aria_internal.voice_command_idempotency (
    owner_user_id, idempotency_key, request_id, device_id, operation, expires_at
  ) VALUES (
    p_owner_user_id, p_idempotency_key, p_request_id, p_device_id, p_operation, p_expires_at
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON TABLE aria_internal.voice_owner_session_nonces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE aria_internal.voice_command_idempotency FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.consume_voice_owner_session_nonce(uuid,text,text,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.claim_voice_command_idempotency(uuid,text,text,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.consume_voice_owner_session_nonce(uuid,text,text,text,text,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.claim_voice_command_idempotency(uuid,text,text,text,text,timestamptz)
  TO service_role;

COMMIT;
