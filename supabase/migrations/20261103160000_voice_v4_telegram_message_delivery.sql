-- ARIA Voice V4 — Telegram delivery with explicit visible confirmation.
-- Message bodies are never persisted. The dispatch row stores only a SHA-256 digest
-- and provider acknowledgement metadata; a send is claimed atomically before HTTP.

BEGIN;

CREATE TABLE IF NOT EXISTS aria_internal.voice_message_recipients (
  owner_user_id uuid NOT NULL,
  recipient_id text NOT NULL,
  display_name text NOT NULL,
  telegram_chat_id text NOT NULL,
  channel text NOT NULL DEFAULT 'telegram' CHECK (channel = 'telegram'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_message_recipients_pk PRIMARY KEY (owner_user_id, recipient_id),
  CONSTRAINT voice_message_recipients_id_format CHECK (
    recipient_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
  ),
  CONSTRAINT voice_message_recipients_name_format CHECK (
    length(trim(display_name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT voice_message_recipients_chat_id_format CHECK (
    telegram_chat_id ~ '^-?[0-9]{1,20}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_message_recipients_owner_chat_idx
  ON aria_internal.voice_message_recipients(owner_user_id, telegram_chat_id);

CREATE TABLE IF NOT EXISTS aria_internal.voice_message_dispatches (
  confirmation_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  recipient_id text NOT NULL,
  body_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'prepared' CHECK (
    status IN ('prepared','dispatching','sent','failed','unknown','expired')
  ),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatch_started_at timestamptz,
  completed_at timestamptz,
  provider_message_id bigint,
  provider_chat_id text,
  error_code text,
  CONSTRAINT voice_message_dispatches_idempotency_uq UNIQUE(owner_user_id, idempotency_key),
  CONSTRAINT voice_message_dispatches_idem_format CHECK (
    length(idempotency_key) BETWEEN 16 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT voice_message_dispatches_recipient_fk FOREIGN KEY(owner_user_id, recipient_id)
    REFERENCES aria_internal.voice_message_recipients(owner_user_id, recipient_id),
  CONSTRAINT voice_message_dispatches_hash_format CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT voice_message_dispatches_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CONSTRAINT voice_message_dispatches_state_consistency CHECK (
    (status IN ('sent','failed','unknown','expired') AND completed_at IS NOT NULL)
    OR (status IN ('prepared','dispatching') AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS voice_message_dispatches_expiry_idx
  ON aria_internal.voice_message_dispatches(expires_at, status);

CREATE OR REPLACE FUNCTION aria_internal.prepare_voice_telegram_message(
  p_owner_user_id uuid,
  p_confirmation_id uuid,
  p_idempotency_key text,
  p_recipient_id text,
  p_body_sha256 text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_row aria_internal.voice_message_dispatches%ROWTYPE;
BEGIN
  IF p_owner_user_id IS NULL OR p_confirmation_id IS NULL
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 128
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
     OR p_recipient_id IS NULL OR p_recipient_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[a-f0-9]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid telegram message preparation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM aria_internal.voice_message_recipients
    WHERE owner_user_id = p_owner_user_id
      AND recipient_id = p_recipient_id
      AND channel = 'telegram'
      AND enabled = true
  ) THEN
    RAISE EXCEPTION 'telegram recipient is not configured';
  END IF;

  INSERT INTO aria_internal.voice_message_dispatches (
    confirmation_id, owner_user_id, idempotency_key, recipient_id, body_sha256, status, expires_at
  ) VALUES (
    p_confirmation_id, p_owner_user_id, p_idempotency_key, p_recipient_id, p_body_sha256, 'prepared', p_expires_at
  )
  ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.confirmation_id IS NULL THEN
    SELECT * INTO v_row
    FROM aria_internal.voice_message_dispatches
    WHERE owner_user_id = p_owner_user_id AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF v_row.recipient_id <> p_recipient_id OR v_row.body_sha256 <> p_body_sha256 THEN
      RAISE EXCEPTION 'telegram idempotency payload mismatch';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'confirmation_id', v_row.confirmation_id,
    'recipient_id', v_row.recipient_id,
    'status', v_row.status,
    'expires_at', v_row.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.claim_voice_telegram_message(
  p_owner_user_id uuid,
  p_confirmation_id uuid,
  p_body_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_row aria_internal.voice_message_dispatches%ROWTYPE;
  v_chat_id text;
  v_claimed boolean := false;
BEGIN
  IF p_owner_user_id IS NULL OR p_confirmation_id IS NULL
     OR p_body_sha256 IS NULL OR p_body_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid telegram message claim';
  END IF;

  UPDATE aria_internal.voice_message_dispatches
  SET status = 'expired', completed_at = now(), error_code = 'confirmation_expired'
  WHERE owner_user_id = p_owner_user_id
    AND confirmation_id = p_confirmation_id
    AND status = 'prepared'
    AND expires_at <= now();

  UPDATE aria_internal.voice_message_dispatches
  SET status = 'dispatching', dispatch_started_at = now()
  WHERE owner_user_id = p_owner_user_id
    AND confirmation_id = p_confirmation_id
    AND body_sha256 = p_body_sha256
    AND status = 'prepared'
    AND expires_at > now()
  RETURNING * INTO v_row;
  v_claimed := v_row.confirmation_id IS NOT NULL;

  IF v_row.confirmation_id IS NULL THEN
    SELECT * INTO v_row
    FROM aria_internal.voice_message_dispatches
    WHERE owner_user_id = p_owner_user_id AND confirmation_id = p_confirmation_id;
  END IF;

  IF v_row.confirmation_id IS NULL THEN RETURN NULL; END IF;

  SELECT telegram_chat_id INTO v_chat_id
  FROM aria_internal.voice_message_recipients
  WHERE owner_user_id = p_owner_user_id
    AND recipient_id = v_row.recipient_id
    AND enabled = true
    AND channel = 'telegram';

  RETURN jsonb_build_object(
    'confirmation_id', v_row.confirmation_id,
    'recipient_id', v_row.recipient_id,
    'telegram_chat_id', v_chat_id,
    'status', v_row.status,
    'claim_state', CASE WHEN v_claimed THEN 'claimed_for_send' ELSE 'not_claimed' END,
    'provider_message_id', v_row.provider_message_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.complete_voice_telegram_message(
  p_owner_user_id uuid,
  p_confirmation_id uuid,
  p_status text,
  p_provider_message_id bigint DEFAULT NULL,
  p_provider_chat_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_owner_user_id IS NULL OR p_confirmation_id IS NULL
     OR p_status NOT IN ('sent','failed','unknown')
     OR (p_status = 'sent' AND (p_provider_message_id IS NULL OR p_provider_message_id <= 0 OR p_provider_chat_id IS NULL))
     OR (p_status <> 'sent' AND p_provider_message_id IS NOT NULL)
     OR (p_error_code IS NOT NULL AND p_error_code NOT IN (
       'telegram_api_rejected','telegram_transport_outcome_unknown','telegram_ack_persistence_failed'
     )) THEN
    RAISE EXCEPTION 'invalid telegram message completion';
  END IF;

  UPDATE aria_internal.voice_message_dispatches
  SET status = p_status,
      provider_message_id = p_provider_message_id,
      provider_chat_id = p_provider_chat_id,
      error_code = p_error_code,
      completed_at = now()
  WHERE owner_user_id = p_owner_user_id
    AND confirmation_id = p_confirmation_id
    AND status = 'dispatching';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

ALTER TABLE aria_internal.voice_message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.voice_message_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE aria_internal.voice_message_recipients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE aria_internal.voice_message_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE aria_internal.voice_message_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE aria_internal.voice_message_dispatches TO service_role;

REVOKE ALL ON FUNCTION aria_internal.prepare_voice_telegram_message(uuid,uuid,text,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.claim_voice_telegram_message(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.complete_voice_telegram_message(uuid,uuid,text,bigint,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.prepare_voice_telegram_message(uuid,uuid,text,text,text,timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.claim_voice_telegram_message(uuid,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.complete_voice_telegram_message(uuid,uuid,text,bigint,text,text)
  TO service_role;

COMMENT ON TABLE aria_internal.voice_message_recipients IS
  'Owner-scoped Telegram allowlist. Chat IDs are only read by service-role API; no public/authenticated policies.';
COMMENT ON TABLE aria_internal.voice_message_dispatches IS
  'One-time Telegram message confirmation and delivery state. Stores content SHA-256 only, never message body, audio or transcript. Unknown outcomes are never auto-retried.';

COMMIT;
