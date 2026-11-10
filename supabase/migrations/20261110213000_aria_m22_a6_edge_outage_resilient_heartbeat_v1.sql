-- A6: keep continuity sampling inside Postgres so transient Edge Runtime
-- origin failures cannot create false heartbeat gaps. Edge dispatch remains
-- asynchronous and is monitored using pg_net's actual HTTP response rows.
begin;

create or replace function aria_internal.aria_m22_a6_monitor_dispatch_http_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal','net'
as $function$
declare
  v_pending record;
  v_response record;
  v_outcome text;
  v_updated integer := 0;
  v_failed_streak integer;
  v_scope_id text;
  v_active_run_id text;
  v_has_recent_success boolean;
begin
  for v_pending in
    select t.sample_id, t.run_id, t.sampled_at,
           (t.payload->>'request_id')::bigint as request_id
      from aria_internal.mission_wonder_2_a6_telemetry t
     where t.event_type='dispatcher_event'
       and t.payload->>'event'='dispatch_http_request'
       and not (t.payload ? 'outcome')
     order by t.sample_id
     for update skip locked
     limit 100
  loop
    select r.id,r.status_code,r.timed_out,r.error_msg,r.headers
      into v_response
      from net._http_response r
     where r.id=v_pending.request_id;

    if found then
      v_outcome := case
        when coalesce(v_response.timed_out,false) then 'http_timeout'
        when v_response.status_code between 200 and 299 then 'edge_2xx'
        when v_response.status_code between 400 and 499 then 'edge_4xx'
        when v_response.status_code between 500 and 599 then 'edge_5xx'
        else 'http_unknown'
      end;
      update aria_internal.mission_wonder_2_a6_telemetry
         set payload=payload||jsonb_build_object(
           'outcome',v_outcome,
           'http_status',v_response.status_code,
           'timed_out',coalesce(v_response.timed_out,false),
           'error_msg',left(coalesce(v_response.error_msg,''),500),
           'cf_ray',coalesce(v_response.headers->>'cf-ray',''),
           'retry_after',coalesce(v_response.headers->>'retry-after',''),
           'response_observed_at',clock_timestamp()
         )
       where sample_id=v_pending.sample_id;
    elsif v_pending.sampled_at < clock_timestamp()-interval '2 minutes' then
      v_outcome := 'response_missing_timeout';
      update aria_internal.mission_wonder_2_a6_telemetry
         set payload=payload||jsonb_build_object(
           'outcome',v_outcome,
           'response_observed_at',clock_timestamp(),
           'response_missing_after_ms',120000
         )
       where sample_id=v_pending.sample_id;
    else
      continue;
    end if;

    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values(v_pending.run_id,'dispatcher_event',jsonb_build_object(
      'event','dispatch_http_result',
      'request_id',v_pending.request_id,
      'outcome',v_outcome
    ));
    v_updated:=v_updated+1;

  end loop;
  -- Evaluate the last five outcomes only after resolving all available HTTP responses.
  -- This prevents a pending 2xx response from being ignored behind five older failures.
  for v_active_run_id in
    select run_id from aria_internal.mission_wonder_2_a6_runs where status='running'
  loop
    select count(*)::integer, coalesce(bool_or(recent.outcome='edge_2xx'),false)
      into v_failed_streak,v_has_recent_success
      from (
        select payload->>'outcome' as outcome
          from aria_internal.mission_wonder_2_a6_telemetry
         where run_id=v_active_run_id
           and event_type='dispatcher_event'
           and payload->>'event'='dispatch_http_result'
         order by sample_id desc
         limit 5
      ) recent
     where recent.outcome is not null;
    if v_failed_streak=5 and not v_has_recent_success then
      select scope_id into v_scope_id
        from aria_internal.mission_wonder_2_a6_scopes
       where run_id=v_active_run_id and status in ('armed','claimed','bound')
       order by ordinal limit 1;
      if v_scope_id is not null then
        perform aria_internal.aria_m22_a6_block_run_v1(
          v_active_run_id,v_scope_id,'a6_dispatch_endpoint_unavailable'
        );
      else
        update aria_internal.mission_wonder_2_a6_runs
           set status='blocked',completed_at=coalesce(completed_at,clock_timestamp()),
               updated_at=clock_timestamp()
         where run_id=v_active_run_id and status='running';
        perform aria_internal.aria_m22_a6_set_dispatcher_active_v1(false);
      end if;
      insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
      values(v_active_run_id,'fault_observed',jsonb_build_object(
        'event','a6_dispatch_endpoint_unavailable',
        'consecutive_dispatch_failures',5,
        'automatic_retry',false
      ));
      exit;
    end if;
  end loop;
  return jsonb_build_object('monitored_responses',v_updated);
end;
$function$;

create or replace function aria_internal.aria_m22_a6_dispatch_tick_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal','net','vault'
as $function$
declare
  v_sample jsonb;
  v_run_id text;
  v_token text;
  v_request_id bigint;
  v_dispatch_error text;
begin
  perform aria_internal.aria_m22_a6_monitor_dispatch_http_v1();
  v_sample := aria_internal.aria_m22_a6_sample_runtime_v1();
  if coalesce(v_sample->>'status','') <> 'sampled' then
    return jsonb_build_object('status',coalesce(v_sample->>'status','unknown'),
      'heartbeat',v_sample,'dispatch_enqueued',false);
  end if;

  v_run_id := v_sample->>'run_id';
  -- Isolate fallible dispatcher work in a PL/pgSQL subtransaction.
  -- Failures here must not roll back the heartbeat sample above.
  begin
    select decrypted_secret into v_token
      from vault.decrypted_secrets
     where name='aria_autonomy_cron_token'
     limit 1;
    if coalesce(v_token,'')='' then
      raise exception 'a6_dispatch_cron_token_missing';
    end if;

    select net.http_post(
      url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-cron-auth-v1',
      headers := jsonb_build_object(
        'x-aria-autonomy-token',v_token,
        'x-aria-dispatcher','mission-wonder-2-a6',
        'Content-Type','application/json'
      ),
      body := '{"action":"dispatch_due"}'::jsonb,
      timeout_milliseconds := 60000
    ) into v_request_id;

    if v_request_id is null then
      raise exception 'a6_dispatch_http_request_not_enqueued';
    end if;
  exception when others then
    v_dispatch_error := sqlstate||':'||left(sqlerrm,400);
  end;

  if v_dispatch_error is not null then
    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values(v_run_id,'dispatcher_event',jsonb_build_object(
      'event','dispatch_enqueue_failed',
      'error',v_dispatch_error,
      'endpoint','aria-cron-auth-v1',
      'heartbeat_preserved',true,
      'automatic_retry',false
    ));
    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values(v_run_id,'dispatcher_event',jsonb_build_object(
      'event','dispatch_http_result',
      'outcome','enqueue_failed',
      'request_id',null,
      'automatic_retry',false
    ));
    return jsonb_build_object(
      'status','sampled_dispatch_failed',
      'run_id',v_run_id,
      'dispatch_enqueued',false,
      'dispatch_error',v_dispatch_error,
      'heartbeat',v_sample,
      'automatic_retry',false
    );
  end if;

  insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
  values(v_run_id,'dispatcher_event',jsonb_build_object(
    'event','dispatch_http_request',
    'request_id',v_request_id,
    'requested_at',clock_timestamp(),
    'endpoint','aria-cron-auth-v1',
    'automatic_retry',false
  ));

  return jsonb_build_object(
    'status','sampled_and_dispatch_enqueued',
    'run_id',v_run_id,
    'request_id',v_request_id,
    'heartbeat',v_sample,
    'automatic_retry',false
  );
end;
$function$;

revoke all on function aria_internal.aria_m22_a6_monitor_dispatch_http_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_dispatch_tick_v1() from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a6_monitor_dispatch_http_v1() to postgres;
grant execute on function aria_internal.aria_m22_a6_dispatch_tick_v1() to postgres;

do $patch$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  if v_job_id is null then
    raise exception 'a6_dedicated_cron_missing';
  end if;
  perform cron.alter_job(
    job_id := v_job_id,
    command := 'select aria_internal.aria_m22_a6_dispatch_tick_v1();'
  );
  if (select active from cron.job where jobid=v_job_id) then
    raise exception 'a6_cron_must_remain_inactive_during_migration';
  end if;
end;
$patch$;

commit;
