'use strict';

const assert = require('node:assert/strict');
const {
  buildCloudflareWorkspacePlan,
  deriveCloudflarePlanProducerToken,
  isCloudflarePlanProducerRequest
} = require('../supabase/functions/aria-planner-v11/cloudflare-workspace-plan-v1.mjs');

(async () => {
  const secret = 'test-only-aria-runtime-secret-'.padEnd(48, 'x');
  const token = await deriveCloudflarePlanProducerToken(secret);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(await deriveCloudflarePlanProducerToken(secret), token);
  assert.notEqual(await deriveCloudflarePlanProducerToken(secret + '!'), token);

  const validRequest = new Request('https://aria.test/functions/v1/aria-planner-v11', {
    method: 'POST',
    headers: {
      'x-aria-plan-producer': 'cloudflare-workspace-v1',
      'x-aria-plan-producer-token': token
    },
    body: JSON.stringify({ goal: 'Read the project status', context: {} })
  });
  assert.equal(await isCloudflarePlanProducerRequest(validRequest, secret), true);
  assert.equal(await isCloudflarePlanProducerRequest(validRequest, secret + '!'), false);
  const missingMarker = new Request(validRequest.url, {
    method: 'POST',
    headers: { 'x-aria-plan-producer-token': token },
    body: '{}'
  });
  assert.equal(await isCloudflarePlanProducerRequest(missingMarker, secret), false);

  const readPlan = buildCloudflareWorkspacePlan('Inspect repository status', {
    version: 'v1',
    tasks: [
      { task_id: 'repo_status', operation: 'git.status', payload: {}, depends_on: [] },
      { task_id: 'read_manifest', operation: 'workspace.read', payload: { path: 'package.json' }, depends_on: ['repo_status'] }
    ]
  });
  assert.equal(readPlan.tasks.length, 2);
  assert.equal(readPlan.tasks[1].depends_on[0], 'repo_status');
  assert.equal(readPlan.requires_human_approval_for_mutations, false);

  const writePlan = buildCloudflareWorkspacePlan('Write a bounded proof file', {
    version: 'v1',
    allow_mutations: true,
    tasks: [{
      task_id: 'proof_write',
      operation: 'workspace.write',
      payload: { path: 'tmp/aria-proof.txt', content: 'proof\n' }
    }]
  });
  assert.equal(writePlan.requires_human_approval_for_mutations, true);
  assert.equal(writePlan.tasks[0].payload.path, 'tmp/aria-proof.txt');

  assert.throws(() => buildCloudflareWorkspacePlan('bad operation', {
    version: 'v1',
    tasks: [{ task_id: 'bad', operation: 'shell.execute', payload: { command: 'whoami' } }]
  }), /plan_operation_rejected/);
  assert.throws(() => buildCloudflareWorkspacePlan('path escape', {
    version: 'v1',
    tasks: [{ task_id: 'bad', operation: 'workspace.read', payload: { path: '../secrets.txt' } }]
  }), /workspace_path_policy_blocked/);
  assert.throws(() => buildCloudflareWorkspacePlan('sensitive path', {
    version: 'v1',
    tasks: [{ task_id: 'bad', operation: 'workspace.read', payload: { path: '.env' } }]
  }), /workspace_path_policy_blocked/);
  assert.throws(() => buildCloudflareWorkspacePlan('mutation without intent', {
    version: 'v1',
    tasks: [{ task_id: 'bad', operation: 'workspace.write', payload: { path: 'a.txt', content: 'x' } }]
  }), /workspace_mutations_not_explicitly_allowed/);
  assert.throws(() => buildCloudflareWorkspacePlan('bad dependency', {
    version: 'v1',
    tasks: [{ task_id: 'one', operation: 'git.status', depends_on: ['later'] }]
  }), /plan_dependency_invalid/);
  assert.throws(() => buildCloudflareWorkspacePlan('bad test path', {
    version: 'v1',
    tasks: [{ task_id: 'one', operation: 'tests.run', payload: { test_file: 'scripts/run.js' } }]
  }), /test_file_policy_blocked/);

  process.stdout.write('CLOUDFLARE_WORKSPACE_PLAN_CONTRACT=PASS\n');
  process.stdout.write('CLOUDFLARE_PLAN_PRODUCER_HMAC_AUTH=PASS\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
