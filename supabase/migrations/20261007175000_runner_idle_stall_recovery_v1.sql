-- ARIA: recover runner idle stalls that hold a lease without an active step/job.
-- This is distinct from replan stalls: the mission already has a valid plan,
-- but the runner stopped between executor selection and step start.

CREATE OR REPLACE FUNCTION aria_internal.recover_running_idle_stalls_v1(
  p_stale_after interval DEFAULT '00:02:00'::interval
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal'
AS $function$
DECLARE n integer := 0;
BEGIN
  UPDATE aria_internal.mission_state m
     SET status='queued',
         lease_owner=null,
         lease_until=null,
         updated_at=clock_timestamp(),
         next_action='next_ready_batch',
         last_stderr='running_idle_stall_recovered',
         finished_at=null,
         recovery_count=coalesce(m.recovery_count,0)+1,
         last_recovery_reason='running_idle_stall_recovered',
         checkpoint=jsonb_set(
           coalesce(m.checkpoint,'{}'::jsonb),
           '{recovery}',
           coalesce(m.checkpoint->'recovery','{}'::jsonb)
             || jsonb_build_object(
               'status','runner_idle_stall_recovered',
               'recovery_required',true,
               'reason','running mission had no active step or pending job beyond the bounded idle window',
               'recovered_at',clock_timestamp()
             ),
           true
         )
   WHERE m.status='running'
     AND m.lease_until IS NOT NULL
     AND m.lease_until>clock_timestamp()
     AND coalesce(m.next_action,'')='next_ready_batch'
     AND coalesce(m.checkpoint->'active_step','null'::jsonb)='null'::jsonb
     AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb
     AND coalesce(m.completed_steps,0)=0
     AND coalesce(m.total_steps,0)>0
     AND lower(coalesce(nullif(m.metadata->>'execution_lane',''),nullif(m.metadata->>'goal_source',''),'')) NOT IN
         ('test','human_gate_e2e','diagnostic','supervisor_probe')
     AND m.updated_at < clock_timestamp()-p_stale_after;

  GET DIAGNOSTICS n=row_count;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.run_mission_runner_tick_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal','vault','net'
AS $function$
DECLARE rid bigint; active_count integer;
BEGIN
  PERFORM aria_internal.recover_running_replan_stalls_v1('00:01:00'::interval);
  PERFORM aria_internal.recover_running_idle_stalls_v1('00:02:00'::interval);

  UPDATE aria_internal.mission_state m
     SET status='failed',lease_owner=null,lease_until=null,
         finished_at=coalesce(m.finished_at,clock_timestamp()),
         next_action='replan: prior execution failed final verification',
         last_stderr=coalesce(m.last_stderr,'final_verification_failed'),
         last_recovery_reason='stale_final_verification_failure_terminalized',
         updated_at=clock_timestamp()
   WHERE m.status='running'
     AND coalesce(m.last_stderr,'')='final_verification_failed'
     AND coalesce(m.next_action,'')='recovery: universal runner exception'
     AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb
     AND coalesce(m.completed_steps,0)>=coalesce(m.total_steps,0)
     AND m.updated_at<clock_timestamp()-interval '2 minutes';

  PERFORM aria_internal.reconcile_meditation_queue_v2();

  SELECT count(*) INTO active_count
  FROM aria_internal.mission_state m
  WHERE m.status IN ('planning','running')
    AND m.lease_until IS NOT NULL
    AND m.lease_until>clock_timestamp()
    AND lower(coalesce(nullif(m.metadata->>'execution_lane',''),nullif(m.metadata->>'goal_source',''),'')) NOT IN
        ('test','human_gate_e2e','diagnostic','supervisor_probe');

  IF active_count>=2 THEN RETURN null; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM aria_internal.mission_state m
    WHERE (
      m.status='queued'
      OR (m.status IN ('planning','running','failed') AND (m.lease_until IS NULL OR m.lease_until<clock_timestamp()))
      OR (m.status='paused' AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
      OR (m.status='waiting' AND coalesce(m.checkpoint->'recovery'->>'status','') IN ('verification_pending','waiting_for_alternative_strategy'))
    )
      AND aria_internal.aria_mission_claim_eligible(m.mission_id)
      AND lower(coalesce(nullif(m.metadata->>'execution_lane',''),nullif(m.metadata->>'goal_source',''),'')) NOT IN
          ('test','human_gate_e2e','diagnostic','supervisor_probe')
  ) THEN RETURN null; END IF;

  SELECT net.http_post(
    url:='https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v22',
    headers:=jsonb_build_object(
      'content-type','application/json',
      'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token')
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  ) INTO rid;
  RETURN rid;
END;
$function$;
