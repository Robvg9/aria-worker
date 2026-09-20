-- Mission event evidence hot-path hardening.
CREATE OR REPLACE FUNCTION aria_evidence.capture_mission_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_evidence'
AS $function$
declare
  v_payload jsonb;
  v_claim text;
begin
  if new.event_type <> 'mission_verified' then
    return new;
  end if;

  v_payload := coalesce(new.payload, '{}'::jsonb);
  v_claim := format('Mission %s passed final mission verification.', new.mission_id);

  begin
    perform aria_evidence.record_claim(
      v_claim,
      'CONFIRMED',
      'aria_mission_event',
      new.event_id::text,
      1.0,
      'aria_internal.mission_events',
      v_payload->>'model_id',
      v_payload->>'model_version',
      new.mission_id,
      v_payload->>'trace_id',
      coalesce(v_payload->>'executor_type', 'mission_runtime'),
      jsonb_build_object(
        'event_id', new.event_id,
        'event_type', new.event_type,
        'step_index', new.step_index,
        'payload', v_payload,
        'created_at', new.created_at
      ),
      '[]'::jsonb,
      null,
      null,
      'mission_event_trigger',
      new.created_at
    );
  exception when others then
    null;
  end;

  return new;
end;
$function$;