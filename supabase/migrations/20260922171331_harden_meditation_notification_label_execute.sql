-- ARIA live security hardening: notification label helper is internal-only.
revoke execute on function aria_internal.meditation_notification_mission_label(text) from public, anon, authenticated;
