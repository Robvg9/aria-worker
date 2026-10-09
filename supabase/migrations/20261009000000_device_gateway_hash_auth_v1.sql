-- Keep bearer device tokens out of PostgreSQL bind/query logs.
-- The Edge Function computes SHA-256 in memory and sends only the lowercase hex digest
-- to these service_role-only RPCs. A digest is never accepted as an incoming bearer
-- token by the Edge Function; that token is hashed again before this boundary.

CREATE OR REPLACE FUNCTION public.authenticate_device_gateway_hash(
  p_device_id text,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aria_internal
AS $function$
DECLARE
  r jsonb;
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN
    RETURN NULL;
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'device_id', d.device_id,
    'agent_type', d.agent_type,
    'status', d.status,
    'capabilities', d.capabilities
  )
    INTO r
  FROM aria_internal.device_registry d
  WHERE d.device_id = p_device_id
    AND d.token_hash = p_token_hash;

  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.authenticate_device_gateway_hash(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_device_gateway_hash(text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enroll_device_hash(
  p_device_id text,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aria_internal
AS $function$
BEGIN
  IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 THEN
    RAISE EXCEPTION 'invalid device id';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid token hash';
  END IF;

  UPDATE aria_internal.device_registry
     SET token_hash = p_token_hash,
         status = CASE WHEN status = 'disabled' THEN status ELSE 'offline' END,
         updated_at = now()
   WHERE device_id = p_device_id
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not pending or not found';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'status', 'offline'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enroll_device_hash(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_device_hash(text,text)
  TO service_role;
