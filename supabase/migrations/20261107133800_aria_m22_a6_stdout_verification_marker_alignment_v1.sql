-- Align the A6 mission runner success check with the artifact reconciler.
-- This function-body-only correction changes no rows, scopes, missions, jobs,
-- leases, cron activation, or global-freeze state.
begin;

do $patch$
declare
  v_definition text;
  v_old text := $old$'stdout_contains','A6_ARTIFACT_VERIFIED;sequence='||lpad(sc.ordinal::text,2,'0')$old$;
  v_new text := $new$'stdout_contains','A6_ARTIFACT_VERIFIED;mode='$new$;
begin
  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_materialize_due_mission_v1(text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'a6_materialize_function_not_found';
  end if;

  if position(v_new in v_definition)>0 and position(v_old in v_definition)=0 then
    null;
  elsif position(v_old in v_definition)>0 then
    execute replace(v_definition,v_old,v_new);
  else
    raise exception 'a6_stdout_verification_contract_unexpected';
  end if;

  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_materialize_due_mission_v1(text,text)'::regprocedure
  ) into v_definition;

  if position(v_new in v_definition)=0 or position(v_old in v_definition)>0 then
    raise exception 'a6_stdout_verification_alignment_failed';
  end if;
end;
$patch$;

commit;
