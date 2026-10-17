-- Create a claimed job for the deterministic start-vs-block race.
INSERT INTO aria_internal.mission_state(mission_id,status)
VALUES ('mi_concurrent_race','running');
SELECT public.enqueue_execution_job_gateway(
  'job_concurrent_race','mi_concurrent_race','device-test','shell.execute',
  'echo must-not-start-after-block',NULL,10000,'{}'::jsonb,'{}'::jsonb
);
SELECT public.claim_execution_job_gateway('device-test');
