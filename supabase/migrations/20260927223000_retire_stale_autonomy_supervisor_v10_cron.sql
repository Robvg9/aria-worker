begin;

-- Retire any remaining pg_cron job whose command still invokes the obsolete
-- aria-autonomy-supervisor-v10 scheduler. The canonical runtime scheduler
-- remains untouched. Match by command instead of a historical job name/ID so
-- renamed legacy cron jobs cannot survive the retirement.
do $$
declare
  r record;
begin
  for r in
    select jobid
    from cron.job
    where command ilike '%aria-autonomy-supervisor-v10%'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

commit;
