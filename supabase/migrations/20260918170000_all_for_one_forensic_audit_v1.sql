begin;

revoke execute on function aria_internal.aria_mission_claim_eligible(p_mission_id text) from public, anon, authenticated;
revoke execute on function aria_internal.aria_mission_queue_health() from public, anon, authenticated;
revoke execute on function aria_internal.certify_historical_live_objective_evidence_v1() from public, anon, authenticated;
revoke execute on function aria_internal.certify_historical_operation_event_proof_v2() from public, anon, authenticated;
revoke execute on function aria_internal.enforce_dynamic_failure_repair_contract() from public, anon, authenticated;
revoke execute on function aria_internal.enforce_goal_latest_mission_state() from public, anon, authenticated;
revoke execute on function aria_internal.enqueue_android_notification_jobs() from public, anon, authenticated;
revoke execute on function aria_internal.guard_confirmed_goal_identity_v1() from public, anon, authenticated;
revoke execute on function aria_internal.guard_dynamic_terminal_objective() from public, anon, authenticated;
revoke execute on function aria_internal.guard_recursive_dynamic_autonomy_goal() from public, anon, authenticated;
revoke execute on function aria_internal.guard_terminal_goal_status_write_v1() from public, anon, authenticated;
revoke execute on function aria_internal.guard_vision_objective_completion() from public, anon, authenticated;
revoke execute on function aria_internal.prevent_structural_dedupe_learning() from public, anon, authenticated;
revoke execute on function aria_internal.queue_forensic_specialized_repair_v1(p_goal_id text) from public, anon, authenticated;
revoke execute on function aria_internal.queue_objective_repair_v1(p_goal_id text) from public, anon, authenticated;
revoke execute on function aria_internal.recover_verified_terminal_missions_v1() from public, anon, authenticated;
revoke execute on function aria_internal.resolve_dependency_goal_id(p_dependency_id text) from public, anon, authenticated;
revoke execute on function aria_internal.run_mission_runner_tick_v1() from public, anon, authenticated;
revoke execute on function aria_internal.sync_vision_objective_status_from_goal() from public, anon, authenticated;
revoke execute on function aria_internal.verify_objective_fulfilled_v7(p_goal_id text) from public, anon, authenticated;
revoke execute on function aria_internal.verify_objective_fulfilled_v8(p_goal_id text) from public, anon, authenticated;
revoke execute on function aria_internal.verify_objective_fulfilled_v9(p_goal_id text) from public, anon, authenticated;

alter function aria_internal.canonical_vision_goal_id(p_objective_id text) set search_path to pg_catalog, aria_internal;
alter function aria_internal.dynamic_failure_repair_guard_smoke() set search_path to pg_catalog;

alter table aria_internal.goal_audit_snapshots_v1
  add constraint goal_audit_snapshots_v1_pk primary key (snapshot_at, goal_id);

create index if not exists claims_parent_evidence_id_idx
  on aria_evidence.claims(parent_evidence_id);
create index if not exists credential_events_identity_id_idx
  on aria_internal.credential_events(identity_id);
create index if not exists execution_jobs_device_id_idx
  on aria_internal.execution_jobs(device_id);
create index if not exists memory_items_supersedes_memory_id_idx
  on aria_memory.memory_items(supersedes_memory_id);
create index if not exists aria_mcp_oauth_codes_client_id_idx
  on public.aria_mcp_oauth_codes(client_id);
create index if not exists aria_mcp_oauth_pending_client_id_idx
  on public.aria_mcp_oauth_pending(client_id);
create index if not exists aria_mcp_oauth_refresh_tokens_client_id_idx
  on public.aria_mcp_oauth_refresh_tokens(client_id);
create index if not exists aria_mcp_oauth_refresh_tokens_rotated_from_idx
  on public.aria_mcp_oauth_refresh_tokens(rotated_from);

update cron.job
set command = $job$
select case
  when exists (
    select 1
    from aria_internal.meditation_control
    where controller_id='primary'
      and desired_mode='active'
  )
  then net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-autonomy-supervisor-v5',
    headers := jsonb_build_object(
      'X-ARIA-AUTONOMY-TOKEN',
      (select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  else null
end;
$job$
where jobid=30;

commit;
