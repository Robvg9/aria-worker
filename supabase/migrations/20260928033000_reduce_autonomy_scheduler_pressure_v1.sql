begin;

-- Reduce pg_cron startup pressure while preserving autonomous queue/supervisor execution.
-- Job 34 remains the single active ARIA autonomy scheduler.
select cron.alter_job(
  job_id := 34,
  schedule := '*/2 * * * *',
  active := true
);

comment on table cron.job is 'ARIA autonomy scheduler uses job 34 at a two-minute cadence to reduce pg_cron startup pressure while preserving recovery/backpressure.';

commit;
