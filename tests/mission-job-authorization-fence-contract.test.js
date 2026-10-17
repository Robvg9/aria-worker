'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261017180000_mission_job_authorization_fence_v1.sql');
const asyncPauseMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261017190000_mission_job_authorization_fence_async_pause_v1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const asyncPauseSql = fs.readFileSync(asyncPauseMigrationPath, 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'aria-agent.js'), 'utf8');
const shellExecutor = fs.readFileSync(path.join(__dirname, '..', 'autonomy', 'windows-shell-executor.js'), 'utf8');
const desktopAdapter = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'windows-desktop-adapter.js'), 'utf8');
const chromeSemanticAction = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'windows-chrome-semantic-action.js'), 'utf8');
const rwhtController = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'autonomous-rwht-controller.js'), 'utf8');
const deviceGateway = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'aria-device-gateway', 'index.ts'), 'utf8');
const integrationSql = fs.readFileSync(path.join(__dirname, 'sql', 'mission-job-authorization-fence.integration.sql'), 'utf8');

const requiredSqlFragments = [
  'CREATE OR REPLACE FUNCTION aria_internal.cancel_unauthorized_pending_jobs',
  "j.status IN ('queued','claimed','running')",
  "status = CASE WHEN j.status = 'queued' THEN 'blocked' ELSE 'cancelled' END",
  'CREATE TRIGGER trg_mission_job_authorization_fence',
  'CREATE OR REPLACE FUNCTION public.start_execution_job_gateway',
  'CREATE OR REPLACE FUNCTION public.complete_execution_job_gateway',
  'fail_closed:mission_not_authorized_at_completion',
  'fail_closed:mission_not_authorized_at_start',
  'CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway',
  'fail_closed:mission_not_authorized_at_claim',
  'CREATE OR REPLACE FUNCTION public.enqueue_execution_job_gateway',
  'mission_not_authorized_for_execution',
  'REVOKE ALL ON FUNCTION public.execution_job_authorization_status_gateway(text,text) FROM PUBLIC, anon, authenticated;',
  'REVOKE ALL ON FUNCTION aria_internal.cancel_unauthorized_pending_jobs(text, text) FROM PUBLIC, anon, authenticated;',
  'REVOKE ALL ON FUNCTION aria_internal.enforce_mission_job_authorization_fence() FROM PUBLIC, anon, authenticated;',
  'GRANT EXECUTE ON FUNCTION public.execution_job_authorization_status_gateway(text,text) TO service_role;',
  'FOR UPDATE',
  'enqueue_android_ui_job',
  'enqueue_android_notification_job',
  'enqueue_execution_job('
];

for (const fragment of requiredSqlFragments) {
  assert.ok(sql.includes(fragment), `authorization fence migration missing required fragment: ${fragment}`);
}

assert.ok(agent.includes('startJobAuthorizationMonitor(job)'), 'physical agent must supervise live mission authorization');
assert.ok(agent.includes('RWHT\\s+PC\\s+E2E'), 'authorization monitor changes must preserve deterministic RWHT goal classification');
assert.ok(agent.includes("'/v1/jobs/'+encodeURIComponent(job.job_id)+'/status'"), 'physical agent must poll the authenticated job status endpoint');
assert.ok(agent.includes('signal:guard.signal'), 'physical execution paths must receive the cancellation signal');
assert.ok(shellExecutor.includes("status: 'cancelled'"), 'PowerShell runner must report cancellation as a non-success');
assert.ok(shellExecutor.includes('killProcessTree(child.pid)'), 'PowerShell runner must terminate the child process tree on cancellation');
assert.ok(desktopAdapter.includes('function abortableDelay(ms, signal)'), 'desktop waits must be interruptible');
assert.ok(desktopAdapter.includes("status: 'cancelled'"), 'desktop automation must propagate cancellation');
assert.ok(chromeSemanticAction.includes('signal.removeEventListener(\'abort\', onAbort)'), 'semantic CDP requests must close on cancellation');
assert.ok(chromeSemanticAction.includes('expression:actionExpression},timeout_ms,pageUrl,signal)'), 'semantic CDP actions must stop retrying after cancellation');
assert.ok(rwhtController.includes('assertNotCancelled'), 'RWHT must check revocation between physical actions');
assert.ok(deviceGateway.includes('jobStatusMatch=p.match'), 'device gateway must expose the authenticated job status endpoint');
assert.ok(deviceGateway.includes("supabase.rpc('execution_job_authorization_status_gateway'"), 'device gateway must use the protected security-definer RPC, not direct internal schema access');
assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.execution_job_authorization_status_gateway'), 'authorization status RPC must not be public');
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.execution_job_authorization_status_gateway'), 'only the service-role gateway may call the status RPC');
assert.ok(deviceGateway.includes("supabase.rpc('execution_job_authorization_status_gateway',{p_job_id:jobId,p_device_id:d.device_id})"), 'device gateway must use the privileged authorization status RPC after authenticating the device');
assert.ok(integrationSql.includes("mi_running_revoke"), 'integration SQL must cover cancellation after a job reaches running');
assert.ok(integrationSql.includes('late agent success must never overwrite'), 'integration SQL must reject stale completion after revocation');
assert.ok(integrationSql.includes('late completion must be rejected after mission revocation'), 'integration SQL must assert that late job results cannot resurrect success');
assert.ok(sql.includes('SELECT m.status INTO v_mission_status') && sql.indexOf('CREATE OR REPLACE FUNCTION public.complete_execution_job_gateway') < sql.lastIndexOf('SELECT m.status INTO v_mission_status'), 'completion path must lock mission before updating a job');
assert.ok(integrationSql.includes("has_function_privilege('anon'"), 'integration SQL must verify the authorization RPC privilege boundary');

assert.ok(asyncPauseSql.includes('CREATE OR REPLACE FUNCTION aria_internal.mission_job_authorization_allowed'), 'corrective migration must use a single mission/job authorization predicate');
assert.ok(asyncPauseSql.includes("v_checkpoint->'recovery'->>'status'"), 'async exception must require waiting_for_async_executor recovery state');
assert.ok(asyncPauseSql.includes("pending.job->>'job_id'=p_job_id"), 'async exception must bind authorization to the exact persisted pending job ID');
assert.ok(asyncPauseSql.includes("v_mission_status <> 'running'"), 'new jobs may only be enqueued while the mission is running');
assert.ok(asyncPauseSql.includes('NOT aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id)'), 'start/completion/status must consult the async-aware fail-closed predicate');
assert.ok(integrationSql.includes('mi_async_pause'), 'integration SQL must preserve the single pending async job during pause');
assert.ok(integrationSql.includes('job_async_unrelated_001'), 'integration SQL must cancel jobs not exactly bound by pending_jobs');
assert.ok(integrationSql.includes('mi_human_gate_pause'), 'integration SQL must cancel unrelated jobs during a Human Gate pause');
assert.ok(integrationSql.includes('mi_alternative_wait'), 'integration SQL must cancel jobs while replanning for an alternative strategy');


const humanGateWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'e2e-human-gate-safe-autonomy.yml'), 'utf8');
assert.ok(humanGateWorkflow.includes('EXACT_PENDING_JOB_BOUND'), 'live Human Gate workflow must verify exact async pending-job binding');
assert.ok(humanGateWorkflow.includes('EXACT_SHA_SUPABASE_DEPLOY_PASS'), 'live Human Gate E2E must wait for the same-SHA runtime deploy before testing');
assert.ok(humanGateWorkflow.includes('EXACT_PROTECTED_JOB_BOUND'), 'approved protected job must bind only the exact pending step');
assert.ok(humanGateWorkflow.includes('HUMAN_GATE_AUTHORIZATION_PASS_PHYSICAL_EXECUTOR_PENDING'), 'workflow must report physical executor unavailable separately from gate authorization');
assert.ok(humanGateWorkflow.includes('test_cleanup_executor_unavailable'), 'unclaimed test jobs must be cancelled rather than left on the production queue');

console.log('mission job authorization fence contract tests passed');
