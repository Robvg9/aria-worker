create or replace function aria_internal.dispatch_meditation_learning_on_success()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare
  v_source text;
  v_token text;
begin
  if new.event_type <> 'mission_succeeded' then
    return new;
  end if;

  select coalesce(metadata->>'source','')
    into v_source
  from aria_internal.mission_state
  where mission_id = new.mission_id;

  if v_source <> 'meditation-ia-v1' then
    return new;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'aria_autonomy_cron_token'
  limit 1;

  if coalesce(v_token,'') = '' then
    return new;
  end if;

  begin
    perform net.http_post(
      url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-learning-v3',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-ARIA-AUTONOMY-TOKEN',v_token
      ),
      body := jsonb_build_object('mission_id', new.mission_id),
      timeout_milliseconds := 15000
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

revoke all on function aria_internal.dispatch_meditation_learning_on_success() from public;
revoke all on function aria_internal.dispatch_meditation_learning_on_success() from anon;
revoke all on function aria_internal.dispatch_meditation_learning_on_success() from authenticated;
grant execute on function aria_internal.dispatch_meditation_learning_on_success() to service_role;

drop trigger if exists trg_meditation_learning_on_success on aria_internal.mission_events;
create trigger trg_meditation_learning_on_success
after insert on aria_internal.mission_events
for each row
execute function aria_internal.dispatch_meditation_learning_on_success();
