-- Mission ownership + stale runner guard + project preview source contract.
-- Keeps user missions visible and prevents failed verification probes from occupying
-- an execution slot indefinitely.

CREATE OR REPLACE FUNCTION aria_internal.ensure_mission_owner_metadata_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal'
AS $$
DECLARE
  v_user_id text;
BEGIN
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb);

  IF coalesce(NEW.metadata->>'goal_source','') = 'user' THEN
    v_user_id := nullif(NEW.metadata->>'user_id','');
    IF v_user_id IS NULL THEN
      v_user_id := nullif(NEW.metadata->>'owner_user_id','');
    END IF;

    IF v_user_id IS NOT NULL THEN
      NEW.metadata := jsonb_set(
        jsonb_set(NEW.metadata,'{user_id}',to_jsonb(v_user_id),true),
        '{owner_user_id}',to_jsonb(v_user_id),true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_mission_owner_metadata_v1
ON aria_internal.mission_state;

CREATE TRIGGER trg_ensure_mission_owner_metadata_v1
BEFORE INSERT OR UPDATE OF metadata ON aria_internal.mission_state
FOR EACH ROW
EXECUTE FUNCTION aria_internal.ensure_mission_owner_metadata_v1();

-- Repair existing user missions created without explicit owner metadata.
-- This project currently has exactly one auth user; only orphaned user missions
-- from the recent window are repaired. No generated mission IDs are hardcoded.
UPDATE aria_internal.mission_state m
SET metadata = jsonb_set(
  jsonb_set(coalesce(m.metadata,'{}'::jsonb),'{user_id}',to_jsonb(u.id::text),true),
  '{owner_user_id}',to_jsonb(u.id::text),true
)
FROM (SELECT id FROM auth.users) u
WHERE (SELECT count(*) FROM auth.users)=1
  AND coalesce(m.metadata->>'goal_source','')='user'
  AND nullif(m.metadata->>'user_id','') IS NULL
  AND nullif(m.metadata->>'owner_user_id','') IS NULL
  AND m.created_at >= clock_timestamp() - interval '6 hours';

-- A failed internal verification probe must never remain RUNNING with its
-- completed plan and no pending execution job.
UPDATE aria_internal.mission_state m
SET status='failed',
    lease_owner=null,
    lease_until=null,
    finished_at=coalesce(m.finished_at,clock_timestamp()),
    next_action='replan: prior execution failed final verification',
    last_stderr=coalesce(m.last_stderr,'final_verification_failed'),
    last_recovery_reason='stale_final_verification_failure_terminalized',
    updated_at=clock_timestamp()
WHERE m.status='running'
  AND coalesce(m.last_stderr,'')='final_verification_failed'
  AND coalesce(m.next_action,'')='recovery: universal runner exception'
  AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb
  AND coalesce(m.completed_steps,0) >= coalesce(m.total_steps,0)
  AND m.updated_at < clock_timestamp() - interval '2 minutes';

CREATE OR REPLACE FUNCTION aria_internal.run_mission_runner_tick_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal','vault','net'
AS $function$
declare
  rid bigint;
  active_count integer;
begin
  -- Free execution slots occupied by a known failed verification probe before
  -- applying the active-count gate.
  update aria_internal.mission_state m
     set status='failed',
         lease_owner=null,
         lease_until=null,
         finished_at=coalesce(m.finished_at,clock_timestamp()),
         next_action='replan: prior execution failed final verification',
         last_stderr=coalesce(m.last_stderr,'final_verification_failed'),
         last_recovery_reason='stale_final_verification_failure_terminalized',
         updated_at=clock_timestamp()
   where m.status='running'
     and coalesce(m.last_stderr,'')='final_verification_failed'
     and coalesce(m.next_action,'')='recovery: universal runner exception'
     and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb
     and coalesce(m.completed_steps,0) >= coalesce(m.total_steps,0)
     and m.updated_at < clock_timestamp() - interval '2 minutes';

  perform aria_internal.reconcile_meditation_queue_v2();

  select count(*)
    into active_count
    from aria_internal.mission_state m
   where m.status in ('planning','running')
     and m.lease_until is not null
     and m.lease_until > clock_timestamp();

  if active_count >= 2 then
    return null;
  end if;

  if not exists (
    select 1
      from aria_internal.mission_state m
     where (
       m.status='queued'
       or (m.status in ('planning','running','failed') and (m.lease_until is null or m.lease_until < clock_timestamp()))
       or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
       or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','') in ('verification_pending','waiting_for_alternative_strategy'))
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
  ) then
    return null;
  end if;

  select net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v22',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into rid;

  return rid;
end;
$function$;
