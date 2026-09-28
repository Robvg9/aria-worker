-- Canonical mission continuation: allow deterministic runner resumption for one mission
-- without relying on global queue ordering and without setting the Meditation trigger.
create or replace function aria_internal.runner_tick_for_mission(p_mission_id text)
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
      'x-aria-autonomy-token',v_token
    ),
    body:=jsonb_build_object('mission_id',p_mission_id),
    timeout_milliseconds:=60000
  ) into v_req;

  return v_req;
end;
$$;

revoke all on function aria_internal.runner_tick_for_mission(text) from public;
revoke all on function aria_internal.runner_tick_for_mission(text) from anon;
revoke all on function aria_internal.runner_tick_for_mission(text) from authenticated;
grant execute on function aria_internal.runner_tick_for_mission(text) to service_role;

comment on function aria_internal.runner_tick_for_mission(text)
is 'Canonical mission-specific runner tick bridge: resumes exactly one mission through aria-canonical-runtime-v1 without Meditation chaining.';
