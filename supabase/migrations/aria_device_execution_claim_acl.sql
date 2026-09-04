-- Security hardening for AF-3 claim RPC: only the server-side service_role may execute it.
REVOKE EXECUTE ON FUNCTION aria_internal.claim_execution_job(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION aria_internal.claim_execution_job(text) FROM anon;
REVOKE EXECUTE ON FUNCTION aria_internal.claim_execution_job(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.claim_execution_job(text) TO service_role;
