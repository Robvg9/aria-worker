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

-- A paired physical device belongs to one Voice V4 owner at a time.
CREATE UNIQUE INDEX IF NOT EXISTS voice_trusted_device_keys_single_owner_idx
  ON aria_internal.voice_trusted_device_keys (device_id);

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

  -- Ownership transfer is permitted only after the prior owner has revoked
  -- this device. The unique device index blocks every active prior pairing.
  DELETE FROM aria_internal.voice_trusted_device_keys
  WHERE device_id = p_device_id
    AND owner_user_id <> p_owner_user_id
    AND enabled = false
    AND revoked_at IS NOT NULL;

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


-- Speaker policy contains only the owner-selected local model ID and threshold.
-- The acoustic template and all voice samples stay encrypted on each device.

CREATE TABLE IF NOT EXISTS aria_internal.voice_speaker_policies (
  owner_user_id uuid NOT NULL,
  device_id text NOT NULL,
  speaker_model_id text NOT NULL,
  minimum_score numeric(5,4) NOT NULL CHECK (minimum_score >= 0 AND minimum_score <= 1),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT voice_speaker_policies_pk PRIMARY KEY (owner_user_id, device_id),
  CONSTRAINT voice_speaker_policies_device_fk
    FOREIGN KEY (owner_user_id, device_id)
    REFERENCES aria_internal.voice_trusted_device_keys(owner_user_id, device_id)
    ON DELETE CASCADE,
  CONSTRAINT voice_speaker_policies_model_format CHECK (
    length(speaker_model_id) BETWEEN 3 AND 160
    AND speaker_model_id ~ '^[A-Za-z0-9._:-]+$'
  )
);

COMMENT ON TABLE aria_internal.voice_speaker_policies IS
  'Server-side speaker model/threshold policy only. No voiceprint, embedding, waveform, or voice sample is stored. The user-owned speaker template remains local and encrypted.';

CREATE OR REPLACE FUNCTION aria_internal.set_voice_speaker_policy(
  p_owner_user_id uuid,
  p_device_id text,
  p_speaker_model_id text,
  p_minimum_score numeric,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL
     OR p_speaker_model_id IS NULL OR length(p_speaker_model_id) NOT BETWEEN 3 AND 160
     OR p_speaker_model_id !~ '^[A-Za-z0-9._:-]+$'
     OR p_minimum_score IS NULL OR p_minimum_score < 0 OR p_minimum_score > 1
     OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid voice speaker policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM aria_internal.voice_trusted_device_keys k
    JOIN aria_internal.device_registry d ON d.device_id = k.device_id
    WHERE k.owner_user_id = p_owner_user_id
      AND k.device_id = p_device_id
      AND k.enabled = true
      AND k.security = 'trusted'
      AND k.revoked_at IS NULL
      AND d.status = 'online'
      AND d.capabilities @> '["audio.wake_word"]'::jsonb
      AND d.last_seen_at >= now() - interval '90 seconds'
  ) THEN
    RAISE EXCEPTION 'trusted voice device unavailable';
  END IF;

  INSERT INTO aria_internal.voice_speaker_policies (
    owner_user_id, device_id, speaker_model_id, minimum_score, enabled,
    created_at, updated_at, revoked_at
  ) VALUES (
    p_owner_user_id, p_device_id, p_speaker_model_id, p_minimum_score, p_enabled,
    now(), now(), NULL
  )
  ON CONFLICT (owner_user_id, device_id) DO UPDATE
  SET speaker_model_id = EXCLUDED.speaker_model_id,
      minimum_score = EXCLUDED.minimum_score,
      enabled = EXCLUDED.enabled,
      updated_at = now(),
      revoked_at = NULL;

  SELECT jsonb_build_object(
    'owner_id', owner_user_id,
    'device_id', device_id,
    'speaker_model_id', speaker_model_id,
    'minimum_score', minimum_score,
    'enabled', enabled,
    'updated_at', updated_at
  ) INTO result
  FROM aria_internal.voice_speaker_policies
  WHERE owner_user_id = p_owner_user_id AND device_id = p_device_id;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.resolve_voice_speaker_policy(
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
    'enabled', p.enabled,
    'modelId', p.speaker_model_id,
    'minimumScore', p.minimum_score
  )
  FROM aria_internal.voice_speaker_policies p
  JOIN aria_internal.voice_trusted_device_keys k
    ON k.owner_user_id = p.owner_user_id AND k.device_id = p.device_id
  JOIN aria_internal.device_registry d ON d.device_id = p.device_id
  WHERE p.owner_user_id = p_owner_user_id
    AND p.device_id = p_device_id
    AND p.enabled = true
    AND p.revoked_at IS NULL
    AND k.enabled = true
    AND k.security = 'trusted'
    AND k.revoked_at IS NULL
    AND d.status = 'online'
    AND d.capabilities @> '["audio.wake_word"]'::jsonb
    AND d.last_seen_at >= now() - interval '90 seconds'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION aria_internal.revoke_voice_speaker_policy(
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
  UPDATE aria_internal.voice_speaker_policies
  SET enabled = false,
      revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  WHERE owner_user_id = p_owner_user_id
    AND device_id = p_device_id
    AND enabled = true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON TABLE aria_internal.voice_speaker_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.set_voice_speaker_policy(uuid,text,text,numeric,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.resolve_voice_speaker_policy(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.revoke_voice_speaker_policy(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.set_voice_speaker_policy(uuid,text,text,numeric,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.resolve_voice_speaker_policy(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.revoke_voice_speaker_policy(uuid,text)
  TO service_role;



-- Model allowlist remains empty until a model passes real target-language,
-- cross-speaker, replay and spoofing evaluations. A synthetic shortlist is
-- never sufficient to approve a production speaker verifier.

CREATE TABLE IF NOT EXISTS aria_internal.voice_speaker_model_catalog (
  model_id text PRIMARY KEY,
  model_family text NOT NULL,
  model_sha256 text NOT NULL,
  supported_languages text[] NOT NULL DEFAULT ARRAY[]::text[],
  minimum_score_floor numeric(5,4) NOT NULL CHECK (minimum_score_floor > 0 AND minimum_score_floor <= 1),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','rejected')),
  evaluation_evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CONSTRAINT voice_speaker_model_id_format CHECK (
    length(model_id) BETWEEN 3 AND 160 AND model_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT voice_speaker_model_family_format CHECK (
    length(model_family) BETWEEN 2 AND 80 AND model_family ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT voice_speaker_model_sha256_format CHECK (
    length(model_sha256) = 64 AND model_sha256 ~ '^[a-f0-9]+$'
  ),
  CONSTRAINT voice_speaker_model_approval_evidence CHECK (
    status <> 'approved' OR (
      evaluation_evidence_ref IS NOT NULL
      AND length(evaluation_evidence_ref) BETWEEN 8 AND 240
      AND approved_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE aria_internal.voice_speaker_model_catalog IS
  'Server allowlist of speaker models. It contains model identifiers and evaluation evidence only, never embeddings or raw voice data. Production policies can use only approved rows.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'voice_speaker_policies_model_fk'
      AND conrelid = 'aria_internal.voice_speaker_policies'::regclass
  ) THEN
    ALTER TABLE aria_internal.voice_speaker_policies
      ADD CONSTRAINT voice_speaker_policies_model_fk
      FOREIGN KEY (speaker_model_id)
      REFERENCES aria_internal.voice_speaker_model_catalog(model_id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END;
$$;

REVOKE ALL ON TABLE aria_internal.voice_speaker_model_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE aria_internal.voice_speaker_model_catalog TO service_role;

-- A previously enabled speaker policy must stop resolving immediately if its
-- model is no longer production-approved or its approval evidence is removed.
CREATE OR REPLACE FUNCTION aria_internal.resolve_voice_speaker_policy(
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
    'enabled', p.enabled,
    'modelId', p.speaker_model_id,
    'minimumScore', GREATEST(p.minimum_score, m.minimum_score_floor)
  )
  FROM aria_internal.voice_speaker_policies p
  JOIN aria_internal.voice_trusted_device_keys k
    ON k.owner_user_id = p.owner_user_id AND k.device_id = p.device_id
  JOIN aria_internal.device_registry d ON d.device_id = p.device_id
  JOIN aria_internal.voice_speaker_model_catalog m
    ON m.model_id = p.speaker_model_id
   AND m.status = 'approved'
   AND m.approved_at IS NOT NULL
   AND m.evaluation_evidence_ref IS NOT NULL
   AND m.supported_languages @> ARRAY['es-CU']::text[]
  WHERE p.owner_user_id = p_owner_user_id
    AND p.device_id = p_device_id
    AND p.enabled = true
    AND p.revoked_at IS NULL
    AND k.enabled = true
    AND k.security = 'trusted'
    AND k.revoked_at IS NULL
    AND d.status = 'online'
    AND d.capabilities @> '["audio.wake_word"]'::jsonb
    AND d.last_seen_at >= now() - interval '90 seconds'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION aria_internal.set_voice_speaker_policy(
  p_owner_user_id uuid,
  p_device_id text,
  p_speaker_model_id text,
  p_minimum_score numeric,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL
     OR p_speaker_model_id IS NULL OR length(p_speaker_model_id) NOT BETWEEN 3 AND 160
     OR p_speaker_model_id !~ '^[A-Za-z0-9._:-]+$'
     OR p_minimum_score IS NULL OR p_minimum_score < 0 OR p_minimum_score > 1
     OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid voice speaker policy';
  END IF;

  IF p_enabled IS TRUE AND NOT EXISTS (
    SELECT 1 FROM aria_internal.voice_speaker_model_catalog m
    WHERE m.model_id = p_speaker_model_id
      AND m.status = 'approved'
      AND m.approved_at IS NOT NULL
      AND m.evaluation_evidence_ref IS NOT NULL
      AND m.supported_languages @> ARRAY['es-CU']::text[]
      AND p_minimum_score >= m.minimum_score_floor
  ) THEN
    RAISE EXCEPTION 'speaker model is not approved or threshold is below its calibrated floor';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM aria_internal.voice_trusted_device_keys k
    JOIN aria_internal.device_registry d ON d.device_id = k.device_id
    WHERE k.owner_user_id = p_owner_user_id
      AND k.device_id = p_device_id
      AND k.enabled = true
      AND k.security = 'trusted'
      AND k.revoked_at IS NULL
      AND d.status = 'online'
      AND d.capabilities @> '["audio.wake_word"]'::jsonb
      AND d.last_seen_at >= now() - interval '90 seconds'
  ) THEN
    RAISE EXCEPTION 'trusted voice device unavailable';
  END IF;

  INSERT INTO aria_internal.voice_speaker_policies (
    owner_user_id, device_id, speaker_model_id, minimum_score, enabled,
    created_at, updated_at, revoked_at
  ) VALUES (
    p_owner_user_id, p_device_id, p_speaker_model_id, p_minimum_score, p_enabled,
    now(), now(), NULL
  )
  ON CONFLICT (owner_user_id, device_id) DO UPDATE
  SET speaker_model_id = EXCLUDED.speaker_model_id,
      minimum_score = EXCLUDED.minimum_score,
      enabled = EXCLUDED.enabled,
      updated_at = now(),
      revoked_at = NULL;

  SELECT jsonb_build_object(
    'owner_id', owner_user_id,
    'device_id', device_id,
    'speaker_model_id', speaker_model_id,
    'minimum_score', minimum_score,
    'enabled', enabled,
    'updated_at', updated_at
  ) INTO result
  FROM aria_internal.voice_speaker_policies
  WHERE owner_user_id = p_owner_user_id AND device_id = p_device_id;

  RETURN result;
END;
$$;



-- Direct device-command queue. Deliberately independent of execution_jobs:
-- no mission_id, job_id, shell, transcript, audio, message body, or arbitrary code.

CREATE TABLE IF NOT EXISTS aria_internal.voice_device_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  device_id text NOT NULL REFERENCES aria_internal.device_registry(device_id) ON DELETE CASCADE,
  source_device_id text NOT NULL REFERENCES aria_internal.device_registry(device_id) ON DELETE CASCADE,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL CHECK (
    operation IN ('display.brightness.set','app.open','browser.open_url')
  ),
  params jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','claimed','running','succeeded','failed','expired','cancelled')
  ),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  CONSTRAINT voice_device_command_request_format CHECK (
    length(request_id) BETWEEN 8 AND 128
  ),
  CONSTRAINT voice_device_command_idempotency_format CHECK (
    length(idempotency_key) BETWEEN 16 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT voice_device_command_params_shape CHECK (
    CASE
      WHEN jsonb_typeof(params) <> 'object' THEN false
      ELSE CASE operation
        WHEN 'display.brightness.set' THEN
          params ? 'brightness'
          AND jsonb_typeof(params->'brightness') = 'number'
          AND (params->>'brightness')::numeric BETWEEN 0 AND 100
          AND jsonb_object_length(params) = 1
        WHEN 'app.open' THEN
          params ? 'app_id'
          AND jsonb_typeof(params->'app_id') = 'string'
          AND length(params->>'app_id') BETWEEN 1 AND 120
          AND params->>'app_id' ~ '^[A-Za-z0-9._-]+$'
          AND jsonb_object_length(params) = 1
        WHEN 'browser.open_url' THEN
          params ? 'url'
          AND jsonb_typeof(params->'url') = 'string'
          AND length(params->>'url') BETWEEN 9 AND 2048
          AND params->>'url' ~ '^https://'
          AND jsonb_object_length(params) = 1
        ELSE false
      END
    END
  ),
  CONSTRAINT voice_device_command_expiry_window CHECK (
    expires_at > requested_at
    AND expires_at <= requested_at + interval '30 seconds'
  ),
  CONSTRAINT voice_device_command_result_shape CHECK (
    jsonb_typeof(result) = 'object'
    AND NOT (result ?| ARRAY['token','access_token','authorization','secret','password','shell','command','transcript','audio','message_body'])
  ),
  CONSTRAINT voice_device_command_error_code_allowlist CHECK (
    error_code IS NULL OR error_code IN (
      'device_unavailable','permission_denied','operation_unsupported',
      'app_not_allowlisted','url_not_allowlisted','native_api_failed',
      'command_expired','command_cancelled','device_busy'
    )
  ),
  CONSTRAINT voice_device_command_completion_consistency CHECK (
    (status IN ('succeeded','failed','expired','cancelled') AND completed_at IS NOT NULL)
    OR (status IN ('queued','claimed','running') AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_device_commands_owner_idempotency_idx
  ON aria_internal.voice_device_commands(owner_user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS voice_device_commands_claim_idx
  ON aria_internal.voice_device_commands(device_id, status, requested_at);
CREATE INDEX IF NOT EXISTS voice_device_commands_source_idx
  ON aria_internal.voice_device_commands(owner_user_id, source_device_id, status);

COMMENT ON TABLE aria_internal.voice_device_commands IS
  'Direct, short-lived, allowlisted device actions. Separate from mission execution_jobs. Never stores mission/job IDs, arbitrary commands, audio, transcripts, or message bodies.';

CREATE OR REPLACE FUNCTION aria_internal.enqueue_voice_device_command(
  p_owner_user_id uuid,
  p_device_id text,
  p_source_device_id text,
  p_request_id text,
  p_idempotency_key text,
  p_operation text,
  p_params jsonb,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_device aria_internal.device_registry%ROWTYPE;
  v_command aria_internal.voice_device_commands%ROWTYPE;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 8 AND 160
     OR p_source_device_id IS NULL OR length(p_source_device_id) NOT BETWEEN 8 AND 160
     OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 8 AND 128
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 128
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
     OR p_operation IS NULL
     OR p_operation NOT IN ('display.brightness.set','app.open','browser.open_url')
     OR p_expires_at IS NULL
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '30 seconds' THEN
    RAISE EXCEPTION 'invalid direct voice command';
  END IF;

  SELECT target.* INTO v_device
  FROM aria_internal.device_registry target
  JOIN aria_internal.voice_trusted_device_keys target_key
    ON target_key.owner_user_id = p_owner_user_id AND target_key.device_id = target.device_id
  JOIN aria_internal.device_registry source
    ON source.device_id = p_source_device_id
  JOIN aria_internal.voice_trusted_device_keys source_key
    ON source_key.owner_user_id = p_owner_user_id AND source_key.device_id = source.device_id
  JOIN aria_internal.voice_speaker_policies source_policy
    ON source_policy.owner_user_id = p_owner_user_id AND source_policy.device_id = source.device_id
  JOIN aria_internal.voice_speaker_model_catalog model
    ON model.model_id = source_policy.speaker_model_id
   AND model.status = 'approved'
   AND model.approved_at IS NOT NULL
   AND model.evaluation_evidence_ref IS NOT NULL
   AND model.supported_languages @> ARRAY['es-CU']::text[]
  WHERE target.device_id = p_device_id
    AND target.status = 'online'
    AND target.last_seen_at >= now() - interval '90 seconds'
    AND target_key.enabled = true AND target_key.security = 'trusted' AND target_key.revoked_at IS NULL
    AND source.status = 'online'
    AND source.last_seen_at >= now() - interval '90 seconds'
    AND source.capabilities @> '["audio.wake_word"]'::jsonb
    AND source_key.enabled = true AND source_key.security = 'trusted' AND source_key.revoked_at IS NULL
    AND source_policy.enabled = true AND source_policy.revoked_at IS NULL
    AND (
      (p_operation = 'display.brightness.set' AND target.capabilities @> '["display.brightness.write"]'::jsonb)
      OR (p_operation = 'app.open' AND target.capabilities @> '["app.open"]'::jsonb)
      OR (p_operation = 'browser.open_url' AND target.capabilities @> '["browser.open_url"]'::jsonb)
    )
  LIMIT 1
  FOR UPDATE OF target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trusted owner-verified voice device unavailable';
  END IF;

  INSERT INTO aria_internal.voice_device_commands (
    owner_user_id, device_id, source_device_id, request_id, idempotency_key,
    operation, params, expires_at
  ) VALUES (
    p_owner_user_id, p_device_id, p_source_device_id, p_request_id, p_idempotency_key,
    p_operation, coalesce(p_params, '{}'::jsonb), p_expires_at
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_command;

  IF v_command.command_id IS NULL THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;

  RETURN jsonb_build_object(
    'status','queued',
    'command_id',v_command.command_id,
    'device_id',v_command.device_id,
    'source_device_id',v_command.source_device_id,
    'operation',v_command.operation,
    'expires_at',v_command.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.claim_voice_device_command(
  p_device_id text,
  p_device_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_token_hash text;
  v_command aria_internal.voice_device_commands%ROWTYPE;
BEGIN
  IF p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 8 AND 160
     OR p_device_token IS NULL OR length(p_device_token) < 32 THEN
    RETURN NULL;
  END IF;
  v_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');

  UPDATE aria_internal.voice_device_commands
  SET status = 'expired', completed_at = now(), error_code = 'command_expired'
  WHERE device_id = p_device_id AND status IN ('queued','claimed','running') AND expires_at <= now();

  WITH next_command AS (
    SELECT c.command_id
    FROM aria_internal.voice_device_commands c
    JOIN aria_internal.device_registry d ON d.device_id = c.device_id
    JOIN aria_internal.voice_trusted_device_keys k
      ON k.owner_user_id = c.owner_user_id AND k.device_id = c.device_id
    JOIN aria_internal.device_registry source
      ON source.device_id = c.source_device_id
    JOIN aria_internal.voice_trusted_device_keys source_key
      ON source_key.owner_user_id = c.owner_user_id AND source_key.device_id = source.device_id
    JOIN aria_internal.voice_speaker_policies s
      ON s.owner_user_id = c.owner_user_id AND s.device_id = source.device_id
    JOIN aria_internal.voice_speaker_model_catalog m
      ON m.model_id = s.speaker_model_id
       AND m.status = 'approved'
       AND m.approved_at IS NOT NULL
       AND m.evaluation_evidence_ref IS NOT NULL
       AND m.supported_languages @> ARRAY['es-CU']::text[]
    WHERE c.device_id = p_device_id
      AND c.status = 'queued'
      AND c.expires_at > now()
      AND k.enabled = true AND k.security = 'trusted' AND k.revoked_at IS NULL
      AND source.status = 'online'
      AND source.last_seen_at >= now() - interval '90 seconds'
      AND source.capabilities @> '["audio.wake_word"]'::jsonb
      AND source_key.enabled = true AND source_key.security = 'trusted' AND source_key.revoked_at IS NULL
      AND s.enabled = true AND s.revoked_at IS NULL
      AND d.token_hash = v_token_hash
      AND d.status = 'online'
      AND d.last_seen_at >= now() - interval '90 seconds'
      AND (
        (c.operation = 'display.brightness.set' AND d.capabilities @> '["display.brightness.write"]'::jsonb)
        OR (c.operation = 'app.open' AND d.capabilities @> '["app.open"]'::jsonb)
        OR (c.operation = 'browser.open_url' AND d.capabilities @> '["browser.open_url"]'::jsonb)
      )
    ORDER BY c.requested_at, c.command_id
    FOR UPDATE OF c SKIP LOCKED
    LIMIT 1
  )
  UPDATE aria_internal.voice_device_commands c
  SET status = 'claimed', claimed_at = now()
  FROM next_command n
  WHERE c.command_id = n.command_id
  RETURNING c.* INTO v_command;

  IF v_command.command_id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'command_id',v_command.command_id,
    'device_id',v_command.device_id,
    'source_device_id',v_command.source_device_id,
    'operation',v_command.operation,
    'params',v_command.params,
    'expires_at',v_command.expires_at,
    'status',v_command.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.complete_voice_device_command(
  p_command_id uuid,
  p_device_id text,
  p_device_token text,
  p_status text,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_token_hash text;
  affected integer;
BEGIN
  IF p_command_id IS NULL
     OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 8 AND 160
     OR p_device_token IS NULL OR length(p_device_token) < 32
     OR p_status IS NULL OR p_status NOT IN ('succeeded','failed')
     OR (p_status = 'succeeded' AND p_error_code IS NOT NULL)
     OR (p_error_code IS NOT NULL AND p_error_code NOT IN (
       'device_unavailable','permission_denied','operation_unsupported',
       'app_not_allowlisted','url_not_allowlisted','native_api_failed',
       'command_expired','command_cancelled','device_busy'
     )) THEN
    RAISE EXCEPTION 'invalid voice command completion';
  END IF;
  IF jsonb_typeof(coalesce(p_result,'{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'voice command result must be an object';
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_object_keys(coalesce(p_result,'{}'::jsonb)) AS item(key)
       WHERE item.key NOT IN ('ok','brightness','app_id','opened','verified')
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_each(coalesce(p_result,'{}'::jsonb)) AS item(key,value)
       WHERE jsonb_typeof(item.value) NOT IN ('string','number','boolean')
          OR (jsonb_typeof(item.value) = 'string' AND length(item.value #>> '{}') > 160)
     ) THEN
    RAISE EXCEPTION 'voice command result contains unsupported fields or values';
  END IF;
  v_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(coalesce(p_result,'{}'::jsonb)) AS item(key,value)
    WHERE (item.key = 'brightness' AND (
             jsonb_typeof(item.value) <> 'number'
             OR (item.value #>> '{}')::numeric NOT BETWEEN 0 AND 100
          ))
       OR (item.key IN ('opened','verified','ok') AND jsonb_typeof(item.value) <> 'boolean')
       OR (item.key IN ('app_id') AND jsonb_typeof(item.value) <> 'string')
  ) THEN
    RAISE EXCEPTION 'voice command result value invalid';
  END IF;

  UPDATE aria_internal.voice_device_commands c
  SET status = p_status,
      result = coalesce(p_result,'{}'::jsonb),
      error_code = p_error_code,
      completed_at = now()
  FROM aria_internal.device_registry d
  WHERE c.command_id = p_command_id
    AND c.device_id = p_device_id
    AND c.device_id = d.device_id
    AND d.token_hash = v_token_hash
    AND d.status = 'online'
    AND d.last_seen_at >= now() - interval '90 seconds'
    AND EXISTS (
      SELECT 1
      FROM aria_internal.voice_trusted_device_keys k
      JOIN aria_internal.device_registry source
        ON source.device_id = c.source_device_id
      JOIN aria_internal.voice_trusted_device_keys source_key
        ON source_key.owner_user_id = c.owner_user_id AND source_key.device_id = source.device_id
      JOIN aria_internal.voice_speaker_policies s
        ON s.owner_user_id = c.owner_user_id AND s.device_id = source.device_id
      JOIN aria_internal.voice_speaker_model_catalog m
        ON m.model_id = s.speaker_model_id
       AND m.status = 'approved'
       AND m.approved_at IS NOT NULL
       AND m.evaluation_evidence_ref IS NOT NULL
       AND m.supported_languages @> ARRAY['es-CU']::text[]
      WHERE k.owner_user_id = c.owner_user_id
        AND k.device_id = c.device_id
        AND k.enabled = true AND k.security = 'trusted' AND k.revoked_at IS NULL
        AND source.status = 'online'
        AND source.last_seen_at >= now() - interval '90 seconds'
        AND source.capabilities @> '["audio.wake_word"]'::jsonb
        AND source_key.enabled = true AND source_key.security = 'trusted' AND source_key.revoked_at IS NULL
        AND s.enabled = true AND s.revoked_at IS NULL
    )
    AND c.status IN ('claimed','running')
    AND c.expires_at > now()
  RETURNING 1 INTO affected;

  RETURN coalesce(affected,0) = 1;
END;
$$;

-- Device revocation is a kill switch for trust and speaker authorization.
-- Queued direct commands involving this device are cancelled atomically.
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
  IF p_owner_user_id IS NULL OR p_device_id IS NULL
     OR length(p_device_id) NOT BETWEEN 8 AND 160
     OR p_device_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'owner and valid device ID are required';
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

  UPDATE aria_internal.voice_speaker_policies
  SET enabled = false,
      revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  WHERE owner_user_id = p_owner_user_id
    AND device_id = p_device_id
    AND enabled = true;

  UPDATE aria_internal.voice_device_commands
  SET status = 'cancelled',
      completed_at = now(),
      error_code = 'command_cancelled'
  WHERE owner_user_id = p_owner_user_id
    AND (device_id = p_device_id OR source_device_id = p_device_id)
    AND status = 'queued';

  RETURN coalesce(affected,0) = 1;
END;
$$;

REVOKE ALL ON FUNCTION aria_internal.revoke_voice_trusted_device_key(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.revoke_voice_trusted_device_key(uuid,text)
  TO service_role;

REVOKE ALL ON TABLE aria_internal.voice_device_commands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.enqueue_voice_device_command(uuid,text,text,text,text,text,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.claim_voice_device_command(text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.complete_voice_device_command(uuid,text,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.enqueue_voice_device_command(uuid,text,text,text,text,text,jsonb,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.claim_voice_device_command(text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.complete_voice_device_command(uuid,text,text,text,jsonb,text)
  TO service_role;


-- Defence in depth for the private Voice V4 schema. No client role receives
-- policies; service_role uses BYPASSRLS, while ordinary roles are deny-by-default.
ALTER TABLE aria_internal.voice_owner_session_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.voice_command_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.voice_trusted_device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.voice_speaker_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.voice_speaker_model_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.voice_device_commands ENABLE ROW LEVEL SECURITY;

-- The authenticated API reads only the result/status row; mutations stay behind
-- the SECURITY DEFINER enqueue/claim/complete RPCs.
GRANT SELECT ON TABLE aria_internal.voice_device_commands TO service_role;

COMMIT;
