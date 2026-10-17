\set ON_ERROR_STOP on
BEGIN;
SELECT status FROM aria_internal.mission_state
 WHERE mission_id='mi_concurrent_race' FOR UPDATE;
SELECT pg_sleep(1);
UPDATE aria_internal.mission_state SET status='blocked'
 WHERE mission_id='mi_concurrent_race';
COMMIT;
