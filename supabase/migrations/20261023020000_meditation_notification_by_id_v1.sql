-- Resolve a single notification by its durable ID for a user-scoped PWA deep link.
-- This avoids relying on the first 50/100 rows of the notification ledger after a native push click.
CREATE OR REPLACE FUNCTION aria_internal.aria_meditation_notification_by_id_for_user_v1(
  p_user_id uuid,
  p_notification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE
  v_controller_owner text;
  v_session_id text;
  v_notification jsonb;
BEGIN
  IF p_user_id IS NULL OR p_notification_id IS NULL THEN
    RAISE EXCEPTION 'notification_user_and_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT mc.owner_user_id::text, mc.session_id::text
    INTO v_controller_owner, v_session_id
    FROM aria_internal.meditation_control AS mc
   WHERE mc.controller_id = 'primary'
   LIMIT 1;

  IF v_controller_owner IS NOT NULL AND v_controller_owner <> p_user_id::text THEN
    RETURN jsonb_build_object('notification', NULL);
  END IF;

  SELECT jsonb_build_object(
      'notification_id', n.notification_id,
      'source_event_id', n.source_event_id,
      'mission_id', n.mission_id,
      'kind', n.kind,
      'severity', n.severity,
      'title', n.title,
      'message', n.message,
      'action', n.action,
      'metadata', n.metadata,
      'read_at', n.read_at,
      'created_at', n.created_at
    )
    INTO v_notification
    FROM aria_internal.meditation_notifications AS n
    JOIN aria_internal.mission_state AS ms ON ms.mission_id = n.mission_id
   WHERE n.notification_id = p_notification_id
     AND (
       ms.metadata->>'user_id' = p_user_id::text
       OR ms.metadata->>'owner_user_id' = p_user_id::text
       OR (NULLIF(v_session_id, '') IS NOT NULL AND ms.metadata->>'meditation_session_id' = v_session_id)
     )
   LIMIT 1;

  RETURN jsonb_build_object('notification', v_notification);
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.aria_meditation_notification_by_id_for_user_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.aria_meditation_notification_by_id_for_user_v1(uuid, uuid) TO service_role;

COMMENT ON FUNCTION aria_internal.aria_meditation_notification_by_id_for_user_v1(uuid, uuid)
  IS 'Returns one persisted Meditation PWA notification by ID only when its mission belongs to the authenticated user/session; supports reliable native notification deep links beyond the recent ledger page.';
