begin;

-- Reduce pg_cron startup pressure while preserving autonomous queue/supervisor execution.
-- Job 34 remains the single active ARIA autonomy scheduler.
select cron.alter_job(
  job_id := 34,
  schedule := '*/2 * * * *',
  active := true
);

commit;
