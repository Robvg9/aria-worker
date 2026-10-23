-- Step 7 follow-up: remove the legacy direct-write path after the RPC-backed API is LIVE.
-- The SECURITY DEFINER append RPC is owned by postgres and is the sole intended write path.
BEGIN;

REVOKE INSERT ON TABLE public.aria_vault_records FROM service_role;

COMMENT ON TABLE public.aria_vault_records IS
  'Private vault ciphertext revisions. Writes must use aria_vault_append_record_revision_v1; service_role direct INSERT is revoked.';

COMMIT;
