-- Governed recovery epoch: reopen autonomous hard blocks when a new recovery capability is deployed.
create table if not exists aria_internal.mission_recovery_epoch (
  singleton boolean primary key default true check (singleton = true),
  epoch bigint not null default 0,
  reason text not null default '',
  updated_at timestamptz not null default now()
);

insert into aria_internal.mission_recovery_epoch(singleton, epoch, reason)
values (true, 0, 'mission recovery epoch initialized')
on conflict (singleton) do nothing;

alter table aria_internal.mission_recovery_epoch enable row level security;
revoke all on aria_internal.mission_recovery_epoch from public, anon, authenticated;
grant all on aria_internal.mission_recovery_epoch to service_role;

create or replace function aria_internal.bump_mission_recovery_epoch(
  p_reason text default 'new governed recovery capability'
)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  update aria_internal.mission_recovery_epoch
     set epoch = epoch + 1,
         reason = coalesce(p_reason, 'new governed recovery capability'),
         updated_at = clock_timestamp()
   where singleton = true
 returning epoch;
$function$;

revoke all on function aria_internal.bump_mission_recovery_epoch(text) from public, anon, authenticated;
grant execute on function aria_internal.bump_mission_recovery_epoch(text) to service_role;

create or replace function aria_internal.aria_reopen_recoverable_hard_blocks(
  p_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_epoch bigint;
  reopened integer := 0;
begin
  select epoch
    into current_epoch
    from aria_internal.mission_recovery_epoch
   where singleton = true;

  if current_epoch is null then
    return 0;
  end if;

  with candidates as (
    select m.mission_id
      from aria_internal.mission_state m
     where m.status = 'blocked'
       and coalesce(m.metadata->>'autonomy_managed','false') = 'true'
       and coalesce(m.checkpoint->'recovery'->>'status','') = 'hard_block'
       and coalesce(m.last_stderr,'') = 'retry_exhausted_all_strategies'
       and (
         case
           when coalesce(m.metadata->>'recovery_epoch','') ~ '^[0-9]+$'
             then (m.metadata->>'recovery_epoch')::bigint
           else 0
         end
       ) < current_epoch
     order by m.updated_at, m.created_at, m.mission_id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit,20),100))
  ), updated as (
    update aria_internal.mission_state m
       set status = 'queued',
           current_step = 0,
           completed_steps = 0,
           attempt_count = 0,
           recovery_count = 0,
           next_action = 'replan: recovery capability epoch advanced',
           last_stderr = 'hard_block_reopened_after_recovery_epoch',
           lease_owner = null,
           lease_until = null,
           finished_at = null,
           updated_at = clock_timestamp(),
           metadata = jsonb_set(
             coalesce(m.metadata,'{}'::jsonb),
             '{recovery_epoch}',
             to_jsonb(current_epoch),
             true
           ),
           checkpoint = jsonb_build_object(
             'recovery',
             jsonb_build_object(
               'status','replan_required',
               'replan_required',true,
               'replan_count',0,
               'recovery_epoch',current_epoch,
               'failure_reason','hard_block_reopened_after_recovery_epoch',
               'failed_step_ids',coalesce(m.checkpoint->'recovery'->'failed_step_ids','[]'::jsonb),
               'block_details',jsonb_build_object(
                 'kind','capability_epoch_recovery',
                 'recoverable',true,
                 'reason','La misión tenía un hard block terminal, pero ARIA dispone ahora de una nueva época de recuperación gobernada.',
                 'next_action','replan: use newly available recovery capability',
                 'remediation','Conservar la evidencia anterior y construir una estrategia diferente usando las capacidades disponibles en esta nueva época.',
                 'recovery_epoch',current_epoch
               ),
               'previous_recovery',coalesce(m.checkpoint->'recovery','{}'::jsonb),
               'previous_plan',coalesce(m.checkpoint->'plan','[]'::jsonb),
               'previous_results',coalesce(m.checkpoint->'results','{}'::jsonb)
             )
           )
      from candidates c
     where m.mission_id = c.mission_id
     returning m.mission_id
  )
  select count(*) into reopened from updated;

  return reopened;
end;
$function$;

revoke all on function aria_internal.aria_reopen_recoverable_hard_blocks(integer) from public, anon, authenticated;
grant execute on function aria_internal.aria_reopen_recoverable_hard_blocks(integer) to service_role;

select aria_internal.bump_mission_recovery_epoch(
  'new governed recovery capability: agent tool-loop mutation completion + PWA recovery + verification diagnostics'
);
select aria_internal.aria_reopen_recoverable_hard_blocks(20);

comment on function aria_internal.bump_mission_recovery_epoch(text)
is 'Advances the governed recovery capability epoch; use when a materially new recovery capability is deployed.';

comment on function aria_internal.aria_reopen_recoverable_hard_blocks(integer)
is 'Reopens autonomy-managed retry-exhausted hard blocks once per recovery capability epoch while preserving prior evidence.';
