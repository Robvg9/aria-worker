create or replace function aria_internal.aria_materialize_human_gate_approval(p_checkpoint jsonb)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, aria_internal
as $function$
declare
  out_checkpoint jsonb := coalesce(p_checkpoint, '{}'::jsonb);
  gate jsonb := coalesce(out_checkpoint->'human_gate', '{}'::jsonb);
  rec jsonb := coalesce(out_checkpoint->'recovery', '{}'::jsonb);
  sid text := coalesce(gate->>'step_id', rec->>'waiting_step_id', '');
  plan jsonb;
  rebuilt jsonb;
begin
  if coalesce(gate->>'approved', 'false') <> 'true' or sid = '' or jsonb_typeof(out_checkpoint->'plan') <> 'array' then
    return out_checkpoint;
  end if;
  plan := out_checkpoint->'plan';
  select coalesce(jsonb_agg(case
    when value->>'id' = sid and (value->>'executor_type') = 'self_improvement' then
      jsonb_set(
        jsonb_set(value, '{risk}', '"LOW"'::jsonb, true),
        '{input}',
        coalesce(value->'input','{}'::jsonb) || jsonb_build_object(
          'risk','LOW',
          'approved_original_risk',coalesce((value->'input'->>'risk'),value->>'risk','HIGH'),
          'human_gate_approved',true
        ), true
      )
    else value
  end order by ordinality), '[]'::jsonb) into rebuilt
  from jsonb_array_elements(plan) with ordinality t(value, ordinality);
  out_checkpoint := jsonb_set(out_checkpoint,'{plan}',rebuilt,true);
  out_checkpoint := jsonb_set(out_checkpoint,'{human_gate,approved_execution}','true'::jsonb,true);
  out_checkpoint := jsonb_set(out_checkpoint,'{human_gate,materialized_at}',to_jsonb(clock_timestamp()),true);
  return out_checkpoint;
end;
$function$;
