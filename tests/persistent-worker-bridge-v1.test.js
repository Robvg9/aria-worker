'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPersistentWorkerBridge, createWorkerBackedPlanner, createWorkerBackedVerifier } = require('../autonomy/persistent-worker-bridge-v1');
const supervisorScriptPath = path.join(__dirname, '..', 'scripts', 'Start-ARIA-Persistent-Worker.ps1');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-worker-bridge-v1-'));
  try {
    const supervisorScript = await fs.readFile(supervisorScriptPath, 'utf8');
    assert.match(supervisorScript, /\[switch\]\$InstallScheduledTask/, 'Windows worker must support one-time scheduled-task installation');
    assert.match(supervisorScript, /New-ScheduledTaskTrigger -AtLogOn -User \$currentUser/, 'worker must restart after interactive user logon');
    assert.match(supervisorScript, /New-ScheduledTaskPrincipal -UserId \$currentUser -LogonType Interactive -RunLevel Limited/, 'scheduled worker must run with limited privileges');
    assert.match(supervisorScript, /Register-ScheduledTask/);
    assert.match(supervisorScript, /New-ScheduledTaskSettingsSet -Disable/, 'a newly registered task must be disabled');
    assert.match(supervisorScript, /Disable-ScheduledTask/, 'the registered task must be explicitly disabled and verified');
    assert.match(supervisorScript, /ARIA_WORKER_TASK_STATE=Disabled/);
    assert.match(supervisorScript, /ARIA_WORKER_TASK_STARTED=false/);
    assert.doesNotMatch(supervisorScript, /Start-ScheduledTask/, 'package 4 must never start the worker while it is being prepared');
    assert.match(supervisorScript, /WorkerConfigIsDpapi/, 'persistent worker operations must require current-user DPAPI config');
    assert.match(supervisorScript, /configuration outside the source checkout/i, 'secrets must remain outside the source checkout');

    const configProtector = await fs.readFile(path.join(__dirname, '..', 'scripts', 'Protect-ARIA-Persistent-Worker-Config.ps1'), 'utf8');
    assert.match(configProtector, /Read-Host 'Enter the existing ARIA_AUTONOMY_WORKER_TOKEN' -AsSecureString/);
    assert.match(configProtector, /ConvertFrom-SecureString -SecureString \$workerToken/);
    assert.match(configProtector, /SetAccessRuleProtection\(\$true, \$false\)/);
    assert.match(configProtector, /aria-worker-config-dpapi-v1/);
    assert.doesNotMatch(supervisorScript, /ARIA_WORKER_TOKEN\s*=\s*['"][^'"]{32,}['"]/, 'worker token must never be hard-coded into the supervisor');
    const bridge = createPersistentWorkerBridge({ directory, leaseMs: 10000 });
    const created = await bridge.enqueue({ mission_id: 'mission_test', task: { task_id: 'task_test', title: 'Run test' }, context: { goal: 'bridge test' } });
    assert.equal(created.status, 'queued');
    const claimed = await bridge.claimNext({ worker_id: 'windows-test-worker', capabilities: ['node'] });
    assert.equal(claimed.job_id, created.job_id);
    assert.equal(claimed.status, 'leased');
    assert.ok(claimed.lease_token);
    await assert.rejects(
      () => bridge.complete(claimed.job_id, { worker_id: 'windows-test-worker', lease_token: 'wrong-token', result: { passed: true } }),
      /worker_lease_mismatch/
    );
    const heartbeat = await bridge.heartbeat(claimed.job_id, { worker_id: 'windows-test-worker', lease_token: claimed.lease_token });
    assert.ok(Date.parse(heartbeat.lease_until) > Date.now());
    const completed = await bridge.complete(claimed.job_id, {
      worker_id: 'windows-test-worker',
      lease_token: claimed.lease_token,
      result: { passed: true, evidence: { test: 'verified' } }
    });
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(await bridge.waitForResult(claimed.job_id), { passed: true, evidence: { test: 'verified' } });

    const expiredJob = await bridge.enqueue({ mission_id: 'mission_expired_lease', task: { task_id: 'expired-task', title: 'Expired lease test' } });
    const expiredClaim = await bridge.claimNext({ worker_id: 'expired-lease-worker', capabilities: ['node'] });
    assert.equal(expiredClaim.job_id, expiredJob.job_id);
    const persistedJobPath = path.join(directory, 'worker-jobs', expiredClaim.job_id + '.json');
    const persistedJob = JSON.parse(await fs.readFile(persistedJobPath, 'utf8'));
    persistedJob.lease_until = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(persistedJobPath, JSON.stringify(persistedJob, null, 2), 'utf8');
    await assert.rejects(
      () => bridge.heartbeat(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token }),
      /worker_lease_expired/
    );
    await assert.rejects(
      () => bridge.complete(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token, result: { passed: true } }),
      /worker_lease_expired/
    );
    persistedJob.lease_until = 'not-a-date';
    await fs.writeFile(persistedJobPath, JSON.stringify(persistedJob, null, 2), 'utf8');
    await assert.rejects(
      () => bridge.heartbeat(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token }),
      /worker_lease_expired/
    );
    await assert.rejects(
      () => bridge.complete(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token, result: { passed: true } }),
      /worker_lease_expired/
    );
    delete persistedJob.lease_until;
    await fs.writeFile(persistedJobPath, JSON.stringify(persistedJob, null, 2), 'utf8');
    await assert.rejects(
      () => bridge.heartbeat(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token }),
      /worker_lease_expired/
    );
    await assert.rejects(
      () => bridge.complete(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token, result: { passed: true } }),
      /worker_lease_expired/
    );
    persistedJob.lease_until = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(persistedJobPath, JSON.stringify(persistedJob, null, 2), 'utf8');
    const replacement = await bridge.claimNext({ worker_id: 'replacement-worker', capabilities: ['node'] });
    assert.equal(replacement.job_id, expiredClaim.job_id);
    assert.notEqual(replacement.lease_token, expiredClaim.lease_token);
    await assert.rejects(
      () => bridge.heartbeat(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token }),
      /worker_lease_mismatch/
    );
    await assert.rejects(
      () => bridge.complete(expiredClaim.job_id, { worker_id: 'expired-lease-worker', lease_token: expiredClaim.lease_token, result: { passed: true } }),
      /worker_lease_mismatch/
    );
    const replacementComplete = await bridge.complete(replacement.job_id, {
      worker_id: 'replacement-worker', lease_token: replacement.lease_token, result: { passed: true, evidence: { fencing: true } }
    });
    assert.equal(replacementComplete.status, 'succeeded');
    const reopened = createPersistentWorkerBridge({ directory });
    assert.equal((await reopened.get(claimed.job_id)).status, 'succeeded');
    const planner = createWorkerBackedPlanner({ bridge, timeoutMs: 300, pollMs: 250 });
    await assert.rejects(() => planner('queued planning mission', { mission_id: 'mission_planning' }), /worker_job_timeout/);
    assert.equal((await bridge.list()).filter(job => job.mission_id === 'mission_planning').length, 1);
    const plannedTasks = [{ task_id: 'read', title: 'Read', operation: 'workspace.read', payload: { path: 'README.md' }, risk: 'low' }];
    const planPromise = planner('queued planning mission', { mission_id: 'mission_planning' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const planJob = await bridge.claimNext({ worker_id: 'planning-worker', capabilities: ['ollama'] });
    assert.equal(planJob.task.operation, 'mission.plan');
    await bridge.complete(planJob.job_id, {
      worker_id: 'planning-worker', lease_token: planJob.lease_token,
      result: { passed: true, evidence: { tasks: plannedTasks } }
    });
    assert.deepEqual(await planPromise, plannedTasks);
    assert.equal((await bridge.list()).filter(job => job.mission_id === 'mission_planning').length, 1);

    const verifier = createWorkerBackedVerifier({ bridge, timeoutMs: 3000, pollMs: 250 });
    const missionSnapshot = { mission_id: 'mission_verify', goal: 'verify test', tasks: [] };
    const verifyPromise = verifier(missionSnapshot);
    await new Promise(resolve => setTimeout(resolve, 20));
    const verifyJob = await bridge.claimNext({ worker_id: 'verification-worker', capabilities: ['ollama'] });
    assert.equal(verifyJob.task.operation, 'mission.verify');
    await bridge.complete(verifyJob.job_id, {
      worker_id: 'verification-worker', lease_token: verifyJob.lease_token,
      result: { passed: true, evidence: { verification: { passed: true, reason: 'test evidence' } } }
    });
    assert.deepEqual(await verifyPromise, { passed: true, reason: 'test evidence' });
    process.stdout.write('persistent-worker-bridge-v1: all tests passed\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
