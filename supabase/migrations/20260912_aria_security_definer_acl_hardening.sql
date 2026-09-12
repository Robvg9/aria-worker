-- Forensic hardening: SECURITY DEFINER routines must never inherit EXECUTE from PUBLIC.
-- Existing explicit postgres/service_role grants are intentionally preserved.
-- Trigger functions continue to work because trigger execution does not depend on PUBLIC EXECUTE.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef = true
      AND n.nspname IN ('aria_internal', 'aria_memory', 'public')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
  END LOOP;
END
$$;
