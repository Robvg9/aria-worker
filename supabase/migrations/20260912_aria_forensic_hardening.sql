-- Forensic hardening applied/verified LIVE on 2026-09-12.
-- This migration makes those changes reproducible from source control.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prosecdef=true AND n.nspname IN ('aria_internal','aria_memory','public')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
  END LOOP;
END $$;

ALTER TABLE aria_internal.agent_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.diagnostic_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE aria_internal.agent_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE aria_internal.diagnostic_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE aria_internal.agent_catalog TO service_role;
GRANT ALL ON TABLE aria_internal.diagnostic_nonces TO service_role;

CREATE OR REPLACE FUNCTION aria_internal.aria_device_effective_status(
  p_status text,
  p_last_seen timestamptz,
  p_max_age interval DEFAULT interval '2 minutes'
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO pg_catalog
AS $$
  SELECT CASE
    WHEN coalesce(lower(trim(p_status)),'offline') <> 'online'
      THEN coalesce(nullif(lower(trim(p_status)),''),'offline')
    WHEN p_last_seen IS NULL THEN 'stale'
    WHEN now() - p_last_seen > p_max_age THEN 'stale'
    ELSE 'online'
  END
$$;
REVOKE ALL ON FUNCTION aria_internal.aria_device_effective_status(text,timestamptz,interval) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.aria_device_effective_status(text,timestamptz,interval) TO service_role,postgres;
