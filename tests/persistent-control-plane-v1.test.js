'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createJsonMissionStore,
  createPersistentAutonomy,
  progressOf
} = require('../autonomy/persistent-control-plane-v1');

async function withStore(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-autonomy-v1-'));
  try { await fn(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

async function testPersistentCompletionAndEvidence() {
  await withStore(async directory => {
    const store = createJsonMissionStore({ directory });
    const autonomy = createPersistentAutonomy({
      store,
      plan: async () => [
        { task_id: 'inspect', title: 'Inspect', risk: 'low' },
        { task_id: 'verify', title: 'Verify', risk: 'low', depends_on: ['inspect'] }
      ],
      executeTask: async task => ({ passed: true, evidence: { task_id: task.task_id, proof: 'test-pass' } }),
      verifyCompletion: async mission => ({ passed: mission.tasks.every(task => task.status === 'succeeded'), verifier: 'test' })
    });
    const created = await autonomy.start({ goal: 'test durable mission' });
    const done = await autonomy.tick(created.mission_id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.progress_percent, 100);
    assert.equal(done.tasks.length, 2);
    assert.equal(done.tasks[0].evidence[0].proof, 'test-pass');
    assert.equal((await store.events(created.mission_id)).some(event => event.type === 'mission_verified_complete'), true);
    const reopened = createJsonMissionStore({ directory });
    assert.equal((await reopened.get(created.mission_id)).status, 'succeeded');
  });
}

async function testHumanGateForIrreversibleAction() {
  await withStore(async directory => {
    const notifications = [];
    const store = createJsonMissionStore({ directory });
    const autonomy = createPersistentAutonomy({
      store,
      plan: async () => [{ task_id: 'deploy', title: 'Deploy', risk: 'high', irreversible: true }],
      executeTask: async () => ({ passed: true, evidence: 'deployment-simulated' }),
      verifyCompletion: async () => ({ passed: true }),
      notify: async event => notifications.push(event)
    });
    const created = await autonomy.start({ goal: 'require approval' });
    const blocked = await autonomy.tick(created.mission_id);
    assert.equal(blocked.status, 'waiting_human');
    assert.equal(blocked.approval.status, 'pending');
    assert.equal(notifications.some(event => event.type === 'human_intervention_required'), true);
    await store.resolveApproval(blocked.approval.approval_id, 'approved', 'test-operator');
    const done = await autonomy.resume(created.mission_id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.tasks[0].status, 'succeeded');
  });
}

async function testVerificationFailureNeverClaimsSuccess() {
  await withStore(async directory => {
    const store = createJsonMissionStore({ directory });
    const autonomy = createPersistentAutonomy({
      store,
      plan: async () => [{ task_id: 'build', title: 'Build', risk: 'low' }],
      executeTask: async () => ({ passed: true, evidence: 'build-output' }),
      verifyCompletion: async () => ({ passed: false, reason: 'live-check-failed' })
    });
    const created = await autonomy.start({ goal: 'must verify' });
    const result = await autonomy.tick(created.mission_id);
    assert.equal(result.status, 'waiting_human');
    assert.equal(result.verification.passed, false);
    assert.notEqual(result.progress_percent, 100);
  });
}

async function testProgressAndInputValidation() {
  assert.equal(progressOf({ status: 'running', tasks: [{ status: 'succeeded' }, { status: 'pending' }] }), 50);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-autonomy-invalid-'));
  try {
    const store = createJsonMissionStore({ directory });
    await assert.rejects(() => store.create({ goal: '', tasks: [] }), /goal_required/);
    await assert.rejects(() => store.create({ goal: 'bad risk', tasks: [{ risk: 'impossible' }] }), /invalid_task_risk/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

(async () => {
  await testPersistentCompletionAndEvidence();
  await testHumanGateForIrreversibleAction();
  await testVerificationFailureNeverClaimsSuccess();
  await testProgressAndInputValidation();
  process.stdout.write('persistent-control-plane-v1: all tests passed\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
