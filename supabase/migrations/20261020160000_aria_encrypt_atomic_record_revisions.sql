-- ARIA Encrypt Step 7 hardening: serialize immutable record revisions per owner/vault/record.
-- This migration changes only the private-vault write path. It does not read or migrate existing content.
BEGIN;

CREATE OR REPLACE FUNCTION public.aria_vault_append_record_revision_v1(
  p_owner_id uuid,
  p_vault_id uuid,
  p_record_id uuid,
  p_revision bigint,
  p_format_version smallint,
  p_payload_nonce text,
  p_ciphertext text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_expected_revision bigint;
BEGIN
  IF p_owner_id IS NULL
     OR p_vault_id IS NULL
     OR p_record_id IS NULL
     OR p_revision IS NULL
     OR p_revision <= 0
     OR p_format_version IS DISTINCT FROM 1
     OR p_payload_nonce IS NULL
     OR p_payload_nonce !~ '^[A-Za-z0-9_-]{16}$'
     OR p_ciphertext IS NULL
     OR pg_catalog.length(p_ciphertext) NOT BETWEEN 22 AND 1398123
     OR p_ciphertext !~ '^[A-Za-z0-9_-]+$'
     OR pg_catalog.length(p_ciphertext) % 4 = 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid record envelope';
  END IF;

  -- One transaction-scoped lock per opaque record identity prevents two writers
  -- from both observing the same max revision and appending out of order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_owner_id::text || ':' || p_vault_id::text || ':' || p_record_id::text,
      0
    )
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.aria_vault_vaults AS v
    WHERE v.owner_id = p_owner_id
      AND v.vault_id = p_vault_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'vault not found';
  END IF;

  SELECT COALESCE(pg_catalog.max(r.revision), 0) + 1
    INTO v_expected_revision
  FROM public.aria_vault_records AS r
  WHERE r.owner_id = p_owner_id
    AND r.vault_id = p_vault_id
    AND r.record_id = p_record_id;

  IF p_revision <> v_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'revision_conflict';
  END IF;

  INSERT INTO public.aria_vault_records (
    owner_id, vault_id, record_id, revision, format_version, payload_nonce, ciphertext
  ) VALUES (
    p_owner_id, p_vault_id, p_record_id, p_revision, p_format_version, p_payload_nonce, p_ciphertext
  );
END;
$function$;

-- Only the guarded function may append a record revision. The app keeps SELECT,
-- while direct service_role INSERT is removed to prevent bypassing the lock.
REVOKE ALL ON FUNCTION public.aria_vault_append_record_revision_v1(
  uuid, uuid, uuid, bigint, smallint, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aria_vault_append_record_revision_v1(
  uuid, uuid, uuid, bigint, smallint, text, text
) TO service_role;
REVOKE INSERT ON TABLE public.aria_vault_records FROM service_role;

COMMENT ON FUNCTION public.aria_vault_append_record_revision_v1(
  uuid, uuid, uuid, bigint, smallint, text, text
) IS 'Atomic append-only vault record write: serializes by record ID, requires next consecutive revision, and is executable only by service_role.';

COMMIT;
