-- ARIA Meditation priority + supervisor decoupling v1
-- Keep queue ordering aligned with mission execution governance.
-- Do not let exploratory idea/test backlog starve a primary objective.

create or replace function aria_internal.meditation_queue_claim_next(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal'
as $function$
declare
  v_row aria_internal.meditation_queue;
begin
  update aria_internal.meditation_queue q
     set status='running',
         started_at=coalesce(q.started_at,clock_timestamp()),
         updated_at=clock_timestamp()
   where q.queue_id = (
     select cq.queue_id
       from aria_internal.meditation_queue cq
       left join aria_internal.mission_state m
         on m.mission_id=cq.item_id
      where cq.device_id=p_device_id
        and cq.status='queued'
      order by
        case lower(coalesce(m.metadata->>'execution_lane',''))
          when 'primary' then 0
          when 'repair' then 10
          when 'user' then 20
          when 'meditation' then 30
          when 'idea' then 90
          when 'test' then 100
          else 50
        end,
        cq.position asc,
        cq.created_at asc,
        cq.queue_id asc
      for update of cq skip locked
      limit 1
   )
   returning q.* into v_row;

  if not found then return null; end if;
  return to_jsonb(v_row);
end;
$function$;

revoke all on function aria_internal.meditation_queue_claim_next(text) from public,anon,authenticated;
grant execute on function aria_internal.meditation_queue_claim_next(text) to service_role;
