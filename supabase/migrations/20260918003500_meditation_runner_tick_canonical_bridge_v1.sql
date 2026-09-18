-- Meditation IA: canonicalize the DB mission tick bridge.
-- The DB helper is operationally used by tests/recovery and must follow the same
-- canonical runtime path as the device gateway, preserving the meditation trigger
-- so runner v22 can perform immediate chaining.
create or replace function aria_internal.meditation_runner_tick_for_mission(p_mission_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_req bigint;
begin
  if p_mission_id is null or length(trim(p_mission_id))=0 then
    raise exception 'mission_id_required';
  end if;

  v_token:=public.read_aria_credential_secret('aria_autonomy_cron_token');
  if v_token is null or length(v_token)<20 then
    raise exception 'autonomy_cron_token_unavailable';
  end if;

  select net.http_post(
    url:='https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-canonical-runtime-v1',
    headers:=jsonb_build_object(
      'content-type','application/json',
      'x-aria-autonomy-token',v_token,
      'x-aria-trigger','meditation-ia'
    ),
    body:=jsonb_build_object('mission_id',p_mission_id),
    timeout_milliseconds:=60000
  ) into v_req;

  return v_req;
end;
$$;

revoke all on function aria_internal.meditation_runner_tick_for_mission(text) from public;
revoke all on function aria_internal.meditation_runner_tick_for_mission(text) from anon;
revoke all on function aria_internal.meditation_runner_tick_for_mission(text) from authenticated;
grant execute on function aria_internal.meditation_runner_tick_for_mission(text) to service_role;

comment on function aria_internal.meditation_runner_tick_for_mission(text)
is 'Meditation IA canonical tick bridge: invoke aria-canonical-runtime-v1 with meditation trigger so mission execution and immediate chaining use the canonical runtime.';
