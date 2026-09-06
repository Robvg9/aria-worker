CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_by_id_lease(p_mission_id text, p_worker_id text, p_lease_for interval DEFAULT '00:02:00'::interval)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
declare claimed jsonb;
begin
  if p_mission_id is null or btrim(p_mission_id) = '' then raise exception 'mission_id_required'; end if;
  if p_worker_id is null or btrim(p_worker_id) = '' then raise exception 'worker_id_required'; end if;
  WITH candidate AS (
    SELECT mission_id
    FROM aria_internal.mission_state
    WHERE mission_id = p_mission_id
      AND (
        status = 'queued'
        OR (status IN ('planning','running','paused','failed') AND lease_until IS NOT NULL AND lease_until < clock_timestamp())
      )
    FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE aria_internal.mission_state m
    SET status = CASE WHEN m.status='queued' THEN 'planning' ELSE m.status END,
        lease_owner = p_worker_id,
        lease_until = clock_timestamp() + p_lease_for,
        updated_at = clock_timestamp(),
        current_workspace = coalesce(m.current_workspace,p_worker_id),
        recovery_count = CASE WHEN m.lease_until IS NOT NULL AND m.lease_until < clock_timestamp() THEN m.recovery_count+1 ELSE m.recovery_count END,
        last_recovery_reason = CASE WHEN m.lease_until IS NOT NULL AND m.lease_until < clock_timestamp() THEN 'lease_expired_reclaimed' ELSE m.last_recovery_reason END
    FROM candidate c
    WHERE m.mission_id=c.mission_id
    RETURNING m.*
  )
  SELECT to_jsonb(updated) INTO claimed FROM updated;
  RETURN claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.aria_mission_claim_by_id_lease(p_mission_id text, p_worker_id text, p_lease_for interval DEFAULT '00:02:00'::interval)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT aria_internal.aria_mission_claim_by_id_lease(p_mission_id,p_worker_id,p_lease_for);
$$;

REVOKE ALL ON FUNCTION public.aria_mission_claim_by_id_lease(text,text,interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aria_mission_claim_by_id_lease(text,text,interval) TO service_role;
