'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260928170000_jobs_recovery_determinism_v1.sql'),'utf8')
  + '\\n'
  + fs.readFileSync(path.join(root,'supabase','migrations','20260928180000_fix_execution_jobs_watchdog_policy_alias_v1.sql'),'utf8')
  + '\\n'
  + fs.readFileSync(path.join(root,'supabase','migrations','20260928220000_fix_execution_jobs_watchdog_policy_alias_v2.sql'),'utf8');
const runner=fs.readFileSync(path.join(root,'supabase/functions/aria-mission-runner-v22/index.ts'),'utf8');

for(const fragment of [
  'runtime_job_policy',
  'max_active_jobs',
  'max_active_jobs_per_device',
  'same_strategy_replan_threshold',
  'same_strategy_hard_block_threshold',
  'execution_job_can_transition',
  'invalid_execution_job_transition',
  'terminal_execution_job_requires_completed_at',
  'terminal_execution_job_must_release_lease',
  'execution_job_backpressure_guard',
  'execution_backpressure_global',
  'execution_backpressure_device',
  'execution_jobs_watchdog',
  'job.recovered',
  'job.timeout',
  'aria-execution-jobs-watchdog-every-minute',
  'cron.schedule',
  'execution_jobs_idempotency_key_uidx',
  'watchdog_grace_ms',
  'timeout_ms',
  'watchdog_running_timeout',
  'v_policy',
  'SELECT to_jsonb(pol)',
  'Normalize existing terminal rows',
  'completed_at=COALESCE(completed_at,updated_at,clock_timestamp())',
]) assert.ok(migration.includes(fragment),`Phase 4 migration missing: ${fragment}`);

for(const fragment of [
  'strategyFingerprint',
  'sameStrategyCount',
  'hardBlockThreshold = 5',
  'forceAlternativeThreshold = 3',
  'same_strategy_repeated_three_times',
  'same_strategy_repeated_five_times',
  'strategy_change_required',
  'strategy_history',
]) assert.ok(runner.includes(fragment),`runner Phase 4 recovery contract missing: ${fragment}`);

assert.match(runner,/status:\s*\"replanned\"/);
assert.match(runner,/next_action:\s*\"replan: discard failed strategy and build an alternative\"/);
assert.match(runner,/lease_owner:\s*null[\s\S]{0,120}lease_until:\s*null/);

console.log('PHASE4 JOBS + RECOVERY CONTRACT: PASS');
const cronBackpressure=fs.readFileSync(path.join(root,'supabase','migrations','20260929160000_cron_backpressure_hardening_v1.sql'),'utf8');
for(const fragment of [
  'aria-autonomy-supervisor-v5-every-5-minutes',
  'aria-execution-jobs-watchdog-every-2-minutes',
  "PERFORM cron.unschedule",
  "timeout_milliseconds := 60000"
]) assert.ok(cronBackpressure.includes(fragment),`Cron backpressure hardening missing: ${fragment}`);

