-- ARIA Voice V4 — Windows DPAPI owner pairing.
-- This identity is READ ONLY: no speaker policy, wake word, or action capability.
-- The private key remains in Windows DPAPI CurrentUser storage.

BEGIN;

CREATE OR REPLACE FUNCTION aria_internal.pair_voice_windows_owner_device(
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
  v_public_key_bytes bytea;
  v_fingerprint text;
  v_token_hash text;
  v_device aria_internal.device_registry%ROWTYPE;
  v_key aria_internal.voice_trusted_device_keys%ROWTYPE;
  v_device_exists boolean;
  v_key_exists boolean;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_token IS NULL OR p_device_token !~ '^[A-Za-z0-9_-]{43}$'
     OR p_public_key_id IS DISTINCT FROM 'aria-windows-dpapi-ed25519-v1'
     OR p_public_key_ed25519 IS NULL OR p_public_key_ed25519 !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid Windows owner pairing request';
  END IF;

  v_public_key_bytes := decode(
    translate(p_public_key_ed25519, '-_', '+/')
      || repeat('=', (4 - (length(p_public_key_ed25519) % 4)) % 4),
    'base64'
  );
  IF length(v_public_key_bytes) <> 32 THEN
    RAISE EXCEPTION 'invalid Ed25519 public key length';
  END IF;

  v_fingerprint := encode(extensions.digest(v_public_key_bytes, 'sha256'), 'hex');
  IF p_device_id IS DISTINCT FROM ('windows-voice-' || v_fingerprint) THEN
    RAISE EXCEPTION 'Windows pairing device ID does not match public key fingerprint';
  END IF;
  v_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id, 0));

  SELECT * INTO v_device
  FROM aria_internal.device_registry
  WHERE device_id = p_device_id
  FOR UPDATE;
  v_device_exists := FOUND;

  SELECT * INTO v_key
  FROM aria_internal.voice_trusted_device_keys
  WHERE device_id = p_device_id
  FOR UPDATE;
  v_key_exists := FOUND;

  IF v_device_exists OR v_key_exists THEN
    IF NOT v_device_exists OR NOT v_key_exists THEN
      RAISE EXCEPTION 'incomplete Windows owner pairing state';
    END IF;
    IF v_device.agent_type IS DISTINCT FROM 'windows-native'
       OR v_device.status = 'disabled'
       OR v_device.metadata->>'voice_pairing' IS DISTINCT FROM 'voice-v4-owner-readonly-v1'
       OR v_device.metadata->>'public_key_fingerprint' IS DISTINCT FROM v_fingerprint
       OR v_key.owner_user_id <> p_owner_user_id
       OR v_key.public_key_id <> p_public_key_id
       OR v_key.public_key_ed25519 <> p_public_key_ed25519
       OR v_key.public_key_fingerprint <> v_fingerprint
       OR v_key.enabled IS DISTINCT FROM true
       OR v_key.security <> 'trusted'
       OR v_key.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Windows owner pairing exists with a different or revoked identity';
    END IF;

    UPDATE aria_internal.device_registry
    SET token_hash = v_token_hash,
        status = 'online',
        capabilities = '[]'::jsonb,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'voice_pairing', 'voice-v4-owner-readonly-v1',
          'public_key_fingerprint', v_fingerprint,
          'wake_word_enabled', false
        ),
        last_seen_at = now(),
        updated_at = now()
    WHERE device_id = p_device_id;

    UPDATE aria_internal.voice_trusted_device_keys
    SET updated_at = now(), last_registered_at = now()
    WHERE owner_user_id = p_owner_user_id AND device_id = p_device_id;
  ELSE
    INSERT INTO aria_internal.device_registry (
      device_id, display_name, agent_type, status, token_hash,
      capabilities, metadata, last_seen_at, created_at, updated_at
    ) VALUES (
      p_device_id, 'ARIA Windows Voice', 'windows-native', 'online', v_token_hash,
      '[]'::jsonb,
      jsonb_build_object(
        'voice_pairing', 'voice-v4-owner-readonly-v1',
        'public_key_fingerprint', v_fingerprint,
        'wake_word_enabled', false
      ),
      now(), now(), now()
    );

    INSERT INTO aria_internal.voice_trusted_device_keys (
      owner_user_id, device_id, public_key_id, public_key_ed25519,
      public_key_fingerprint, security, enabled, revoked_at,
      created_at, updated_at, last_registered_at
    ) VALUES (
      p_owner_user_id, p_device_id, p_public_key_id, p_public_key_ed25519,
      v_fingerprint, 'trusted', true, NULL, now(), now(), now()
    );
  END IF;

  RETURN jsonb_build_object(
    'owner_id', p_owner_user_id,
    'device_id', p_device_id,
    'public_key_id', p_public_key_id,
    'public_key_fingerprint', v_fingerprint,
    'security', 'trusted',
    'enabled', true,
    'registered_at', now(),
    'capabilities', '[]'::jsonb,
    'wake_word_enabled', false,
    'mode', 'read_only'
  );
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.touch_voice_windows_owner_device(
  p_owner_user_id uuid,
  p_device_id text,
  p_device_token text
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
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL OR p_device_id !~ '^windows-voice-[a-f0-9]{64}$'
     OR p_device_token IS NULL OR p_device_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;

  v_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  UPDATE aria_internal.device_registry d
  SET status = 'online',
      capabilities = '[]'::jsonb,
      last_seen_at = now(),
      updated_at = now()
  WHERE d.device_id = p_device_id
    AND d.agent_type = 'windows-native'
    AND d.metadata->>'voice_pairing' = 'voice-v4-owner-readonly-v1'
    AND d.metadata->>'wake_word_enabled' = 'false'
    AND d.token_hash = v_token_hash
    AND d.status <> 'disabled'
    AND EXISTS (
      SELECT 1
      FROM aria_internal.voice_trusted_device_keys k
      WHERE k.owner_user_id = p_owner_user_id
        AND k.device_id = d.device_id
        AND k.enabled = true
        AND k.security = 'trusted'
        AND k.revoked_at IS NULL
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON FUNCTION aria_internal.pair_voice_windows_owner_device(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.touch_voice_windows_owner_device(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.pair_voice_windows_owner_device(uuid,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.touch_voice_windows_owner_device(uuid,text,text)
  TO service_role;

COMMENT ON FUNCTION aria_internal.pair_voice_windows_owner_device(uuid,text,text,text,text) IS
  'Pairs a Windows DPAPI Ed25519 identity for authenticated read-only Voice V4 sessions only. No audio, speaker verification, or action capability is enabled.';

COMMIT;
