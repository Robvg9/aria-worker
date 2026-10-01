create or replace function aria_internal.reconcile_mission_queue_governance_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  n_missing integer := 0;
  n_duplicate integer := 0;
  n_terminal integer := 0;
  n_stale integer := 0;
  n_retry integer := 0;
  n_blocked integer := 0;
  n_resumed_blocked integer := 0;
begin
  update aria_internal.mission_state m
     set status='cancelled',
         next_action='governance:cancelled_missing_goal',
         finished_at=clock_timestamp(),
         lease_owner=null,
         lease_until=null,
         checkpoint=coalesce(m.checkpoint,'{}'::jsonb) ||
           jsonb_build_object('queue_governance',jsonb_build_object('status','reconciled','reason','missing_goal','at',clock_timestamp()))
   where m.status='queued'
     and nullif(btrim(m.metadata->>'goal_id'),'') is not null
     and not exists (
       select 1 from aria_internal.autonomy_goals g
        where g.goal_id=nullif(btrim(m.metadata->>'goal_id'),'')
     );
  get diagnostics n_missing = row_count;

  update aria_internal.mission_state m
     set status='cancelled',
         next_action='governance:cancelled_historical_duplicate',
         finished_at=clock_timestamp(),
         lease_owner=null,
         lease_until=null,
         checkpoint=coalesce(m.checkpoint,'{}'::jsonb) ||
           jsonb_build_object('queue_governance',jsonb_build_object('status','reconciled','reason','historical_duplicate','at',clock_timestamp()))
   where m.status='queued'
     and nullif(btrim(m.metadata->>'goal_id'),'') is not null
     and exists (
       select 1 from aria_internal.autonomy_goals g
        where g.goal_id=nullif(btrim(m.metadata->>'goal_id'),'')
          and g.objective_verification_status='DUPLICATE_HISTORICAL'
     );
  get diagnostics n_duplicate = row_count;

  update aria_internal.mission_state m
     set status='cancelled',
         next_action='governance:cancelled_terminal_goal',
         finished_at=clock_timestamp(),
         lease_owner=null,
         lease_until=null,
         checkpoint=coalesce(m.checkpoint,'{}'::jsonb) ||
           jsonb_build_object('queue_governance',jsonb_build_object('status','reconciled','reason','terminal_goal','at',clock_timestamp()))
   where m.status='queued'
     and nullif(btrim(m.metadata->>'goal_id'),'') is not null
     and exists (
       select 1 from aria_internal.autonomy_goals g
        where g.goal_id=nullif(btrim(m.metadata->>'goal_id'),'')
          and g.status='completed'
     );
  get diagnostics n_terminal = row_count;

  update aria_internal.mission_state m
     set status='cancelled',
         next_action='governance:cancelled_stale_goal_pointer',
         finished_at=clock_timestamp(),
         lease_owner=null,
         lease_until=null,
         checkpoint=coalesce(m.checkpoint,'{}'::jsonb) ||
           jsonb_build_object('queue_governance',jsonb_build_object('status','reconciled','reason','stale_goal_pointer','at',clock_timestamp()))
   where m.status='queued'
     and nullif(btrim(m.metadata->>'goal_id'),'') is not null
     and exists (
       select 1 from aria_internal.autonomy_goals g
        where g.goal_id=nullif(btrim(m.metadata->>'goal_id'),'')
          and g.last_mission_id is distinct from m.mission_id
     );
  get diagnostics n_stale = row_count;

  update aria_internal.mission_state m
     set status='blocked',
         next_action='replan: retry exhausted',
         checkpoint=coalesce(m.checkpoint,'{}'::jsonb) ||
           jsonb_build_object('queue_governance',jsonb_build_object('status','reconciled','reason','retry_exhausted','replan_required',true,'at',clock_timestamp()))
   where m.status='queued'
     and coalesce(m.checkpoint->'recovery'->>'status','')='retry_exhausted';
  get diagnostics n_retry = row_count;

  update aria_internal.autonomy_goals g
     set status='queued',
         next_run_at=clock_timestamp(),
         updated_at=clock_timestamp()
   where g.status='blocked'
     and exists (
       select 1
       from aria_internal.mission_state m
       where m.status='queued'
         and nullif(btrim(m.metadata->>'goal_id'),'')=g.goal_id
         and coalesce(m.metadata->>'resume_blocked_goal','')='true'
         and coalesce(m.checkpoint->'recovery'->>'replan_required','')='false'
         and jsonb_typeof(m.checkpoint->'plan')='array'
         and jsonb_array_length(coalesce(m.checkpoint->'plan','[]'::jsonb))>0
     );
  get diagnostics n_resumed_blocked = row_count;

  update aria_internal.mission_state m
     set status='blocked',
         next_action=case when coalesce(m.next_action,'') like 'human_gate:%' then m.next_action else 'replan: blocked objective requires replan' end,
         checkpoint=coalesce(m.checkpoint,'{}'::jsonb) ||
           jsonb_build_object('queue_governance',jsonb_build_object('status','reconciled','reason','blocked_goal','replan_required',true,'at',clock_timestamp()))
   where m.status='queued'
     and nullif(btrim(m.metadata->>'goal_id'),'') is not null
     and exists (
       select 1 from aria_internal.autonomy_goals g
        where g.goal_id=nullif(btrim(m.metadata->>'goal_id'),'')
          and g.status='blocked'
     )
     and not (
       coalesce(m.metadata->>'resume_blocked_goal','')='true'
       and coalesce(m.checkpoint->'recovery'->>'replan_required','')='false'
       and jsonb_typeof(m.checkpoint->'plan')='array'
       and jsonb_array_length(coalesce(m.checkpoint->'plan','[]'::jsonb))>0
     );
  get diagnostics n_blocked = row_count;

  return jsonb_build_object(
    'version','v3',
    'checked_at',clock_timestamp(),
    'cancelled_missing_goal',n_missing,
    'cancelled_historical_duplicate',n_duplicate,
    'cancelled_terminal_goal',n_terminal,
    'cancelled_stale_goal_pointer',n_stale,
    'blocked_retry_exhausted',n_retry,
    'resumed_explicitly_regoverned_blocked_goal',n_resumed_blocked,
    'blocked_goal_requires_replan',n_blocked
  );
end;
$function$;
