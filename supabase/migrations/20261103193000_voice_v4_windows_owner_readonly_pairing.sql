-- ARIA Voice V4 — Windows DPAPI owner pairing.
-- Voice identity metadata is separate from the Windows agent's device token and capabilities.
-- The private key and voice-pairing token remain protected with Windows DPAPI CurrentUser.

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
  v_voice_token_hash text;
  v_device aria_internal.device_registry%ROWTYPE;
  v_key aria_internal.voice_trusted_device_keys%ROWTYPE;
  v_key_exists boolean;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL OR p_device_id !~ '^windows-[A-Za-z0-9._:-]{1,120}$'
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
  v_voice_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id, 0));

  SELECT * INTO v_device
  FROM aria_internal.device_registry
  WHERE device_id = p_device_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_device.agent_type IS DISTINCT FROM 'windows-local'
     OR v_device.status IS DISTINCT FROM 'online'
     OR v_device.status = 'disabled' THEN
    RAISE EXCEPTION 'online Windows agent device is required for voice pairing';
  END IF;

  SELECT * INTO v_key
  FROM aria_internal.voice_trusted_device_keys
  WHERE device_id = p_device_id
  FOR UPDATE;
  v_key_exists := FOUND;

  IF v_key_exists THEN
    IF v_key.owner_user_id <> p_owner_user_id
       OR v_key.public_key_id <> p_public_key_id
       OR v_key.public_key_ed25519 <> p_public_key_ed25519
       OR v_key.public_key_fingerprint <> v_fingerprint
       OR v_key.enabled IS DISTINCT FROM true
       OR v_key.security <> 'trusted'
       OR v_key.revoked_at IS NOT NULL
       OR v_device.metadata->>'voice_pairing' IS DISTINCT FROM 'voice-v4-owner-readonly-v1'
       OR v_device.metadata->>'voice_owner_id' IS DISTINCT FROM p_owner_user_id::text
       OR v_device.metadata->>'public_key_fingerprint' IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Windows owner pairing exists with a different or revoked identity';
    END IF;
    UPDATE aria_internal.voice_trusted_device_keys
    SET updated_at = now(), last_registered_at = now()
    WHERE owner_user_id = p_owner_user_id AND device_id = p_device_id;
  ELSE
    IF v_device.metadata->>'voice_pairing' IS NOT NULL THEN
      RAISE EXCEPTION 'incomplete Windows owner pairing state';
    END IF;

    INSERT INTO aria_internal.voice_trusted_device_keys (
      owner_user_id, device_id, public_key_id, public_key_ed25519,
      public_key_fingerprint, security, enabled, revoked_at,
      created_at, updated_at, last_registered_at
    ) VALUES (
      p_owner_user_id, p_device_id, p_public_key_id, p_public_key_ed25519,
      v_fingerprint, 'trusted', true, NULL, now(), now(), now()
    );
  END IF;

  -- Keep device_registry.token_hash, capabilities, status and normal agent heartbeat intact.
  UPDATE aria_internal.device_registry
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'voice_pairing', 'voice-v4-owner-readonly-v1',
        'voice_owner_id', p_owner_user_id::text,
        'voice_pairing_token_hash', v_voice_token_hash,
        'public_key_fingerprint', v_fingerprint,
        'wake_word_enabled', false
      ),
      updated_at = now()
  WHERE device_id = p_device_id;

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
  v_voice_token_hash text;
  affected integer;
BEGIN
  IF p_owner_user_id IS NULL
     OR p_device_id IS NULL OR p_device_id !~ '^windows-[A-Za-z0-9._:-]{1,120}$'
     OR p_device_token IS NULL OR p_device_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;

  v_voice_token_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  UPDATE aria_internal.device_registry d
  SET metadata = coalesce(d.metadata, '{}'::jsonb)
      || jsonb_build_object('last_voice_heartbeat_at', now()),
      updated_at = now()
  WHERE d.device_id = p_device_id
    AND d.agent_type = 'windows-local'
    AND d.status = 'online'
    AND d.metadata->>'voice_pairing' = 'voice-v4-owner-readonly-v1'
    AND d.metadata->>'voice_owner_id' = p_owner_user_id::text
    AND d.metadata->>'wake_word_enabled' = 'false'
    AND d.metadata->>'voice_pairing_token_hash' = v_voice_token_hash
    AND EXISTS (
      SELECT 1
      FROM aria_internal.voice_trusted_device_keys k
      WHERE k.owner_user_id = p_owner_user_id
        AND k.device_id = d.device_id
        AND k.enabled = true
        AND k.security = 'trusted'
        AND k.revoked_at IS NULL
        AND k.public_key_fingerprint = d.metadata->>'public_key_fingerprint'
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
  'Pairs a Windows DPAPI Ed25519 identity for authenticated read-only Voice V4 sessions without changing the normal device token or capabilities.';

COMMIT;
