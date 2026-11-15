-- Align the A6 frozen-device authorization predicate with the canonical
-- marker emitted by the A6 mission plan (created|identical modes).
-- This function-definition-only migration creates or mutates no runtime rows,
-- missions, jobs, scopes, leases, cron state, secrets, or global-freeze state.
begin;

do $patch$
declare
  v_definition text;
  v_old text := $old$'A6_ARTIFACT_VERIFIED;sequence='||lpad(s.ordinal::text,2,'0')$old$;
  v_new text := $new$'A6_ARTIFACT_VERIFIED;mode='$new$;
begin
  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'a6_frozen_job_authorization_function_not_found';
  end if;

  if position(v_new in v_definition)>0 and position(v_old in v_definition)=0 then
    null;
  elsif position(v_old in v_definition)>0 then
    execute replace(v_definition,v_old,v_new);
  else
    raise exception 'a6_frozen_job_marker_contract_unexpected';
  end if;

  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text)'::regprocedure
  ) into v_definition;

  if position(v_new in v_definition)=0 or position(v_old in v_definition)>0 then
    raise exception 'a6_frozen_job_marker_alignment_failed';
  end if;
end;
$patch$;

commit;
