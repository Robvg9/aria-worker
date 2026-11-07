begin;

do $block$
declare
  v_job_id bigint;
  v_count integer;
  v_active boolean;
  v_command text;
begin
  select count(*) into v_count
    from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  if v_count<>1 then
    raise exception 'a6_dispatcher_cron_missing_or_duplicate';
  end if;

  select jobid,active into v_job_id,v_active
    from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';

  if v_active is distinct from false then
    raise exception 'a6_dispatcher_must_remain_inactive_during_slot_reuse';
  end if;

  perform cron.alter_job(
    job_id := v_job_id,
    command := $command$
select net.http_post(
  url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-cron-auth-v1',
  headers := jsonb_build_object(
    'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
    'x-aria-dispatcher','mission-wonder-2-a6',
    'Content-Type','application/json'
  ),
  body := '{"action":"dispatch_due"}'::jsonb,
  timeout_milliseconds := 60000
);
$command$
  );

  select command,active into v_command,v_active
    from cron.job
   where jobid=v_job_id;

  if position('/functions/v1/aria-cron-auth-v1' in coalesce(v_command,''))=0
     or position('x-aria-dispatcher' in coalesce(v_command,''))=0
     or position('dispatch_due' in coalesce(v_command,''))=0 then
    raise exception 'a6_dispatcher_command_reroute_verification_failed';
  end if;
  if v_active is distinct from false then
    raise exception 'a6_dispatcher_activation_state_changed';
  end if;
end;
$block$;

commit;
