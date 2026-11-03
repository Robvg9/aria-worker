-- Hardening for sensitive tables in the private aria_internal schema.
-- Applied to Supabase LIVE as migration 20261103024005.
-- No RLS policies are intentionally defined: anon/authenticated have neither
-- USAGE on aria_internal nor table grants. With RLS enabled and no policies,
-- access is default-deny for non-bypass roles. service_role remains the
-- approved backend access path and has BYPASSRLS; do not FORCE ROW LEVEL SECURITY.

ALTER TABLE "aria_internal"."meditation_push_deliveries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "aria_internal"."runtime_auth_token_hashes"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "aria_internal"."aria_encrypt_step5_http_probe_evidence"
  ENABLE ROW LEVEL SECURITY;
