-- Replace large client-built mission_id IN (...) URL filters with bounded database-side joins.
-- These RPCs are callable only by the server-side service_role; user identity is supplied
-- by the authenticated Edge Function after requireUser() has validated the JWT.

CREATE OR REPLACE FUNCTION aria_internal.aria_meditation_notifications_for_user_v1(
  p_user_id uuid,
  p_unread_only boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE
  v_controller_owner text;
  v_session_id text;
  v_mission_ids text[] := ARRAY[]::text[];
  v_notifications jsonb := '[]'::jsonb;
  v_unread_count bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'notification_user_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT mc.owner_user_id::text, mc.session_id::text
    INTO v_controller_owner, v_session_id
    FROM aria_internal.meditation_control AS mc
   WHERE mc.controller_id = 'primary'
   LIMIT 1;

  IF v_controller_owner IS NOT NULL AND v_controller_owner <> p_user_id::text THEN
    RETURN jsonb_build_object(
      'version', 'aria-meditation-notifications-v1',
      'notifications', '[]'::jsonb,
      'unread_count', 0,
      'external_channels', jsonb_build_object('configured', true, 'channels', jsonb_build_array('web_push'))
    );
  END IF;

  SELECT COALESCE(array_agg(ms.mission_id), ARRAY[]::text[])
    INTO v_mission_ids
    FROM aria_internal.mission_state AS ms
   WHERE ms.metadata->>'user_id' = p_user_id::text
      OR ms.metadata->>'owner_user_id' = p_user_id::text
      OR (NULLIF(v_session_id, '') IS NOT NULL AND ms.metadata->>'meditation_session_id' = v_session_id);

  IF cardinality(v_mission_ids) = 0 THEN
    RETURN jsonb_build_object(
      'version', 'aria-meditation-notifications-v1',
      'notifications', '[]'::jsonb,
      'unread_count', 0,
      'external_channels', jsonb_build_object('configured', true, 'channels', jsonb_build_array('web_push'))
    );
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO v_notifications
    FROM (
      SELECT n.notification_id, n.source_event_id, n.mission_id, n.kind, n.severity,
             n.title, n.message, n.action, n.metadata, n.read_at, n.created_at
        FROM aria_internal.meditation_notifications AS n
       WHERE n.mission_id = ANY(v_mission_ids)
         AND (NOT COALESCE(p_unread_only, false) OR n.read_at IS NULL)
       ORDER BY n.created_at DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) AS q;

  SELECT count(*)
    INTO v_unread_count
    FROM aria_internal.meditation_notifications AS n
   WHERE n.mission_id = ANY(v_mission_ids)
     AND n.read_at IS NULL;

  RETURN jsonb_build_object(
    'version', 'aria-meditation-notifications-v1',
    'notifications', v_notifications,
    'unread_count', COALESCE(v_unread_count, 0),
    'external_channels', jsonb_build_object('configured', true, 'channels', jsonb_build_array('web_push'))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.aria_mark_meditation_notifications_read_for_user_v1(
  p_user_id uuid,
  p_notification_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_all boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $function$
DECLARE
  v_controller_owner text;
  v_session_id text;
  v_mission_ids text[] := ARRAY[]::text[];
  v_updated_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'notification_user_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_all, false) AND cardinality(COALESCE(p_notification_ids, ARRAY[]::uuid[])) = 0 THEN
    RAISE EXCEPTION 'notification_ids_or_all_required' USING ERRCODE = '22023';
  END IF;

  SELECT mc.owner_user_id::text, mc.session_id::text
    INTO v_controller_owner, v_session_id
    FROM aria_internal.meditation_control AS mc
   WHERE mc.controller_id = 'primary'
   LIMIT 1;

  IF v_controller_owner IS NOT NULL AND v_controller_owner <> p_user_id::text THEN
    RETURN jsonb_build_object('ok', true, 'marked_read', 0, 'notification_ids', '[]'::jsonb);
  END IF;

  SELECT COALESCE(array_agg(ms.mission_id), ARRAY[]::text[])
    INTO v_mission_ids
    FROM aria_internal.mission_state AS ms
   WHERE ms.metadata->>'user_id' = p_user_id::text
      OR ms.metadata->>'owner_user_id' = p_user_id::text
      OR (NULLIF(v_session_id, '') IS NOT NULL AND ms.metadata->>'meditation_session_id' = v_session_id);

  IF cardinality(v_mission_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'marked_read', 0, 'notification_ids', '[]'::jsonb);
  END IF;

  WITH changed AS (
    UPDATE aria_internal.meditation_notifications AS n
       SET read_at = now()
     WHERE n.mission_id = ANY(v_mission_ids)
       AND (
         (COALESCE(p_all, false) AND n.read_at IS NULL)
         OR (NOT COALESCE(p_all, false) AND n.notification_id = ANY(COALESCE(p_notification_ids, ARRAY[]::uuid[])))
       )
    RETURNING n.notification_id
  )
  SELECT COALESCE(array_agg(changed.notification_id), ARRAY[]::uuid[])
    INTO v_updated_ids
    FROM changed;

  RETURN jsonb_build_object(
    'ok', true,
    'marked_read', cardinality(v_updated_ids),
    'notification_ids', to_jsonb(v_updated_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.aria_meditation_notifications_for_user_v1(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.aria_mark_meditation_notifications_read_for_user_v1(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.aria_meditation_notifications_for_user_v1(uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.aria_mark_meditation_notifications_read_for_user_v1(uuid, uuid[], boolean) TO service_role;

COMMENT ON FUNCTION aria_internal.aria_meditation_notifications_for_user_v1(uuid, boolean, integer)
  IS 'User-scoped Meditation PWA notifications returned through server-side SQL; avoids long PostgREST mission_id filter URLs.';
COMMENT ON FUNCTION aria_internal.aria_mark_meditation_notifications_read_for_user_v1(uuid, uuid[], boolean)
  IS 'User-scoped Meditation PWA notification read acknowledgement through server-side SQL.';
