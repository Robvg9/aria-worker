-- Fast-path execution job claim when there is no work to claim or stale work to recover.
-- Preserves the existing recovery/claim behavior when queued or expired work exists.

create or replace function aria_internal.claim_execution_job(p_device_id text)
returns setof aria_internal.execution_jobs
language plpgsql
security definer
set search_path to 'aria_internal', 'pg_catalog'
as $function$
declare
  v_device_status text;
  v_recovered record;
begin
  select status into v_device_status
    from aria_internal.device_registry
   where device_id = p_device_id;

  if not found or v_device_status = 'disabled' then
    return;
  end if;

  if not exists (
       select 1
       from aria_internal.execution_jobs q
       where q.status = 'queued'
         and (q.device_id is null or q.device_id = p_device_id)
     )
     and not exists (
       select 1
       from aria_internal.execution_jobs q
       where q.status = 'claimed'
         and q.completed_at is null
         and q.lease_until is not null
         and q.lease_until < clock_timestamp()
     )
     and not exists (
       select 1
       from aria_internal.execution_jobs q
       where q.status = 'running'
         and q.completed_at is null
         and q.lease_until is not null
         and q.lease_until < clock_timestamp()
         and q.updated_at < clock_timestamp() - interval '10 seconds'
     )
  then
    return;
  end if;

  update aria_internal.execution_jobs
     set status='queued',
         claimed_at=null,
         lease_owner=null,
         lease_until=null,
         updated_at=clock_timestamp(),
         recovery_count=coalesce(recovery_count,0)+1,
         stderr=concat_ws(E'\n', nullif(stderr,''), 'requeued: claim lease expired before start')
   where status='claimed'
     and completed_at is null
     and lease_until is not null
     and lease_until < clock_timestamp();

  for v_recovered in
    update aria_internal.execution_jobs
       set status='timeout',
           completed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           lease_owner=null,
           lease_until=null,
           recovery_count=coalesce(recovery_count,0)+1,
           exit_code=null,
           stderr=concat_ws(E'\n', nullif(stderr,''), 'timeout: execution lease expired while running')
     where status='running'
       and completed_at is null
       and lease_until is not null
       and lease_until < clock_timestamp()
       and updated_at < clock_timestamp() - interval '10 seconds'
     returning job_id, device_id
  loop
    insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    values (
      v_recovered.job_id,
      coalesce(v_recovered.device_id, p_device_id),
      'job.timeout',
      jsonb_build_object(
        'reason','stale_running_lease',
        'recovered_by_device_id',p_device_id,
        'recovered_at',clock_timestamp()
      )
    );
  end loop;

  return query
  update aria_internal.execution_jobs j
     set device_id=p_device_id,
         status='claimed',
         claimed_at=clock_timestamp(),
         lease_owner=md5(p_device_id || ':' || clock_timestamp()::text || ':' || random()::text),
         lease_until=clock_timestamp() + ((greatest(j.timeout_ms, 1000) + 60000)::numeric * interval '1 millisecond'),
         updated_at=clock_timestamp()
   where j.job_id=(
     select q.job_id
       from aria_internal.execution_jobs q
      where q.status='queued'
        and (q.device_id is null or q.device_id=p_device_id)
      order by q.requested_at,q.job_id
      for update skip locked
      limit 1
   )
   returning j.*;
end;
$function$;
