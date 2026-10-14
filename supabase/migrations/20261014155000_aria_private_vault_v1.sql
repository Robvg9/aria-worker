-- ARIA Encrypt Step 4: zero-knowledge vault persistence boundary.
-- This migration creates storage only. It does not migrate existing personal data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.aria_vault_vaults (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vault_id uuid NOT NULL,
  format_version smallint NOT NULL DEFAULT 1 CHECK (format_version = 1),
  kdf_id text NOT NULL CHECK (kdf_id = 'argon2id-v1.3'),
  kdf_params jsonb NOT NULL CHECK (kdf_params = '{"m":65536,"t":3,"p":4}'::jsonb),
  kdf_salt text NOT NULL CHECK (kdf_salt ~ '^[A-Za-z0-9_-]{22}$'),
  password_wrap_nonce text NOT NULL CHECK (password_wrap_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  wrapped_vault_key text NOT NULL CHECK (wrapped_vault_key ~ '^[A-Za-z0-9_-]{64}$'),
  recovery_wrap_nonce text NOT NULL CHECK (recovery_wrap_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  recovery_wrapped_vault_key text NOT NULL CHECK (recovery_wrapped_vault_key ~ '^[A-Za-z0-9_-]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, vault_id)
);

CREATE TABLE IF NOT EXISTS public.aria_vault_records (
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  format_version smallint NOT NULL DEFAULT 1 CHECK (format_version = 1),
  payload_nonce text NOT NULL CHECK (payload_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  ciphertext text NOT NULL CHECK (
    length(ciphertext) BETWEEN 22 AND 1398123
    AND ciphertext ~ '^[A-Za-z0-9_-]+$'
    AND length(ciphertext) % 4 <> 1
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, vault_id, record_id, revision),
  CONSTRAINT aria_vault_records_vault_owner_fk
    FOREIGN KEY (owner_id, vault_id)
    REFERENCES public.aria_vault_vaults(owner_id, vault_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS aria_vault_records_lookup_idx
  ON public.aria_vault_records (owner_id, vault_id, record_id, revision DESC);

CREATE TABLE IF NOT EXISTS public.aria_vault_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'vault.list', 'vault.read', 'vault.config',
    'record.list', 'record.read', 'record.write', 'request.rejected'
  )),
  outcome text NOT NULL CHECK (outcome IN (
    'started', 'ok', 'denied', 'not_found', 'rate_limited', 'error'
  )),
  resource_id uuid,
  status_code integer CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, request_id)
);

CREATE INDEX IF NOT EXISTS aria_vault_audit_recent_idx
  ON public.aria_vault_audit_events (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.aria_vault_rate_windows (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('vault.read', 'vault.write', 'vault.config')),
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count > 0),
  PRIMARY KEY (owner_id, action)
);

ALTER TABLE public.aria_vault_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aria_vault_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aria_vault_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aria_vault_rate_windows ENABLE ROW LEVEL SECURITY;

-- The tables live in the exposed public schema, but only the server's service_role
-- can access them. There are deliberately no policies for client roles.
REVOKE ALL ON TABLE public.aria_vault_vaults FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.aria_vault_records FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.aria_vault_audit_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.aria_vault_rate_windows FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.aria_vault_vaults TO service_role;
GRANT SELECT, INSERT ON TABLE public.aria_vault_records TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.aria_vault_audit_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.aria_vault_rate_windows TO service_role;

-- Atomic per-owner/action rate gate. It never sees vault passwords, keys or content.
-- SECURITY DEFINER is tightly scoped, uses an empty search_path, fully-qualified
-- objects, and EXECUTE is revoked from all client roles.
CREATE OR REPLACE FUNCTION public.aria_vault_consume_rate_limit_v1(
  p_owner_id uuid,
  p_action text
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_window timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_limit integer;
  v_hits integer;
  v_retry integer;
BEGIN
  IF p_owner_id IS NULL OR p_action NOT IN ('vault.read', 'vault.write', 'vault.config') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid rate limit request';
  END IF;

  v_limit := CASE p_action
    WHEN 'vault.read' THEN 120
    WHEN 'vault.write' THEN 30
    WHEN 'vault.config' THEN 12
  END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text || ':' || p_action, 0)
  );

  INSERT INTO public.aria_vault_rate_windows AS current_window
    (owner_id, action, window_start, hit_count)
  VALUES (p_owner_id, p_action, v_window, 1)
  ON CONFLICT (owner_id, action) DO UPDATE
    SET window_start = CASE
          WHEN current_window.window_start < EXCLUDED.window_start
            THEN EXCLUDED.window_start
          ELSE current_window.window_start
        END,
        hit_count = CASE
          WHEN current_window.window_start < EXCLUDED.window_start
            THEN 1
          ELSE current_window.hit_count + 1
        END
  RETURNING hit_count INTO v_hits;

  v_retry := pg_catalog.ceil(
    EXTRACT(EPOCH FROM ((v_window + interval '1 minute') - pg_catalog.now()))
  )::integer;
  IF v_retry < 1 THEN
    v_retry := 1;
  END IF;

  RETURN QUERY SELECT (v_hits <= v_limit), v_retry;
END;
$function$;

REVOKE ALL ON FUNCTION public.aria_vault_consume_rate_limit_v1(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aria_vault_consume_rate_limit_v1(uuid, text) TO service_role;

COMMENT ON TABLE public.aria_vault_vaults IS
  'ARIA zero-knowledge vault configuration. Only opaque IDs, Argon2id parameters/salt, and encrypted key wrappers; service_role only.';
COMMENT ON TABLE public.aria_vault_records IS
  'ARIA private vault append-only encrypted record revisions. No title/body/cleartext columns; service_role only.';
COMMENT ON TABLE public.aria_vault_audit_events IS
  'ARIA private vault security audit. Metadata only; never store request bodies, credentials, keys, ciphertext or plaintext.';
COMMENT ON TABLE public.aria_vault_rate_windows IS
  'Atomic per-owner/action rate-limit buckets for ARIA private vault endpoints; service_role only.';

COMMIT;
