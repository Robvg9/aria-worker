-- Android device authentication must not depend on PostgREST exposing aria_internal.
-- Validate the token inside PostgreSQL and return only the device identity fields
-- required by the gateway.
CREATE OR REPLACE FUNCTION public.authenticate_device_gateway(
  p_device_id text,
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aria_internal
AS $$
DECLARE
  v_hash text;
  r jsonb;
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN
    RETURN NULL;
  END IF;

  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN NULL;
  END IF;

  SELECT encode(extensions.digest(p_token, 'sha256'), 'hex')
    INTO v_hash;

  SELECT jsonb_build_object(
    'device_id', d.device_id,
    'agent_type', d.agent_type,
    'status', d.status,
    'capabilities', d.capabilities
  )
    INTO r
  FROM aria_internal.device_registry d
  WHERE d.device_id = p_device_id
    AND d.token_hash = v_hash;

  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authenticate_device_gateway(text,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.authenticate_device_gateway(text,text)
  TO service_role;
