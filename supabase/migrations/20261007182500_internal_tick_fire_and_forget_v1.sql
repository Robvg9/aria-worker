-- Internal mission tick must be a fire-and-forget trigger.
-- Do not hold the Postgres request open for the entire agent/model mission.
CREATE OR REPLACE FUNCTION aria_internal.runner_tick_for_mission(p_mission_id text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
      'authorization','Bearer '||v_token,
      'x-aria-trigger','mission-tick'
    ),
    body:=jsonb_build_object('mission_id',p_mission_id),
    timeout_milliseconds:=5000
  ) into v_req;

  return v_req;
end;
$function$;
