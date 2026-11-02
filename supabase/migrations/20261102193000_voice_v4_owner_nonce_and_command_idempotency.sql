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


-- Public key registry: the private Ed25519 key stays in the device OS keystore.
-- A row is usable only while the paired device is online and reports the
-- explicit audio.wake_word capability.
CREATE TABLE IF NOT EXISTS aria_internal.voice_trusted_device_keys (
  owner_user_id uuid NOT NULL,
  device_id text NOT NULL REFERENCES aria_internal.device_registry(device_id) ON DELETE CASCADE,
  public_key_id text NOT NULL,
  public_key_ed25519 text NOT NULL,
  public_key_fingerprint text NOT NULL,
  security text NOT NULL DEFAULT 'trusted' CHECK (security IN ('trusted','restricted','blocked')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_trusted_device_keys_pk PRIMARY KEY (owner_user_id, device_id),
  CONSTRAINT voice_trusted_device_keys_id_format CHECK (
    length(public_key_id) BETWEEN 8 AND 128
    AND public_key_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT voice_trusted_device_keys_public_key_format CHECK (
    length(public_key_ed25519) = 43
    AND public_key_ed25519 ~ '^[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT voice_trusted_device_keys_fingerprint_format CHECK (
    length(public_key_fingerprint) = 64
    AND public_key_fingerprint ~ '^[a-f0-9]+$'
  )
);

CREATE INDEX IF NOT EXISTS voice_trusted_device_keys_device_idx
  ON aria_internal.voice_trusted_device_keys (device_id, enabled, security);

COMMENT ON TABLE aria_internal.voice_trusted_device_keys IS
  'Owner-authorized Ed25519 public keys for signed ARIA Voice V4 requests. Private keys remain in Android Keystore / Windows DPAPI; this table stores public keys only.';

CREATE OR REPLACE FUNCTION aria_internal.register_voice_trusted_device_key(
  p_owner_user_id uuid,
  p_device_id text,
  p_device_token text,
  p_public_key_id text,
  p_public_key_ed25519 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_token_hash text;
  v_public_key_bytes bytea;
  v_fingerprint text;
  v_device aria_internal.device_registry%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 8 AND 160
     OR p_device_token IS NULL OR length(p_device_token) < 32
     OR p_public_key_id IS NULL OR length(p_public_key_id) NOT BETWEEN 8 AND 128
     OR p_public_key_id !~ '^[A-Za-z0-9._:-]+$'
     OR p_public_key_ed25519 IS NULL OR length(p_public_key_ed25519) <> 43
     OR p_public_key_ed25519 !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid voice device key registration';
  END IF;

  v_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  v_public_key_bytes := decode(
    translate(p_public_key_ed25519, '-_', '+/')
      || repeat('=', (4 - (length(p_public_key_ed25519) % 4)) % 4),
    'base64'
  );
  IF length(v_public_key_bytes) <> 32 THEN
    RAISE EXCEPTION 'invalid Ed25519 public key length';
  END IF;
  v_fingerprint := encode(extensions.digest(v_public_key_bytes, 'sha256'), 'hex');

  SELECT * INTO v_device
  FROM aria_internal.device_registry
  WHERE device_id = p_device_id
    AND token_hash = v_token_hash
    AND status = 'online'
    AND capabilities @> '["audio.wake_word"]'::jsonb
    AND last_seen_at >= now() - interval '90 seconds'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'voice device is not paired, online, or wake-word capable';
  END IF;

  INSERT INTO aria_internal.voice_trusted_device_keys (
    owner_user_id, device_id, public_key_id, public_key_ed25519,
    public_key_fingerprint, security, enabled, revoked_at,
    created_at, updated_at, last_registered_at
  ) VALUES (
    p_owner_user_id, p_device_id, p_public_key_id, p_public_key_ed25519,
    v_fingerprint, 'trusted', true, NULL,
    now(), now(), now()
  )
  ON CONFLICT (owner_user_id, device_id) DO UPDATE
  SET public_key_id = EXCLUDED.public_key_id,
      public_key_ed25519 = EXCLUDED.public_key_ed25519,
      public_key_fingerprint = EXCLUDED.public_key_fingerprint,
      security = 'trusted',
      enabled = true,
      revoked_at = NULL,
      updated_at = now(),
      last_registered_at = now();

  SELECT jsonb_build_object(
    'owner_id', owner_user_id,
    'device_id', device_id,
    'public_key_id', public_key_id,
    'public_key_fingerprint', public_key_fingerprint,
    'security', security,
    'enabled', enabled,
    'registered_at', last_registered_at
  ) INTO v_result
  FROM aria_internal.voice_trusted_device_keys
  WHERE owner_user_id = p_owner_user_id AND device_id = p_device_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.resolve_voice_trusted_device_key(
  p_owner_user_id uuid,
  p_device_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'owner_id', v.owner_user_id,
    'device_id', v.device_id,
    'public_key_id', v.public_key_id,
    'public_key', v.public_key_ed25519,
    'public_key_fingerprint', v.public_key_fingerprint,
    'security', v.security,
    'enabled', v.enabled,
    'health', 'healthy',
    'last_seen_at', d.last_seen_at
  )
  FROM aria_internal.voice_trusted_device_keys v
  JOIN aria_internal.device_registry d ON d.device_id = v.device_id
  WHERE v.owner_user_id = p_owner_user_id
    AND v.device_id = p_device_id
    AND v.enabled = true
    AND v.security = 'trusted'
    AND v.revoked_at IS NULL
    AND d.status = 'online'
    AND d.capabilities @> '["audio.wake_word"]'::jsonb
    AND d.last_seen_at >= now() - interval '90 seconds'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION aria_internal.revoke_voice_trusted_device_key(
  p_owner_user_id uuid,
  p_device_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_owner_user_id IS NULL OR p_device_id IS NULL THEN
    RAISE EXCEPTION 'owner and device are required';
  END IF;
  UPDATE aria_internal.voice_trusted_device_keys
  SET enabled = false,
      security = 'blocked',
      revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  WHERE owner_user_id = p_owner_user_id
    AND device_id = p_device_id
    AND enabled = true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON TABLE aria_internal.voice_trusted_device_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.register_voice_trusted_device_key(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.resolve_voice_trusted_device_key(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.revoke_voice_trusted_device_key(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.register_voice_trusted_device_key(uuid,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.resolve_voice_trusted_device_key(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.revoke_voice_trusted_device_key(uuid,text)
  TO service_role;
