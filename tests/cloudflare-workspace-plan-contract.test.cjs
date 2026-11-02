'use strict';

const assert = require('node:assert/strict');
const { isCloudflarePlanProducerPath } = require('../supabase/functions/aria-planner-v11/cloudflare-plan-producer-path-v1.mjs');
const { sanitizeCloudflarePlanFailureReason } = require('../supabase/functions/aria-planner-v11/cloudflare-workspace-plan-v1.mjs');
const {
  buildCloudflareWorkspacePlan,
  buildCloudflareWorkspacePrompt,
  deriveCloudflarePlanProducerToken,
  isCloudflarePlanProducerRequest
} = require('../supabase/functions/aria-planner-v11/cloudflare-workspace-plan-v1.mjs');
const {
  deriveCloudflarePlanPreviewToken,
  isCloudflarePlanPreviewRequest
} = require('../supabase/functions/_shared/cloudflare-plan-preview-auth-v1.mjs');

(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const plannerSourcePath = path.join(__dirname, '..', 'supabase', 'functions', 'aria-planner-v11', 'index.ts');
  const plannerSource = fs.readFileSync(plannerSourcePath, 'utf8');
  const executionRuntimePath = path.join(__dirname, '..', 'supabase', 'functions', 'aria-execution-runtime-v1', 'index.ts');
  const executionRuntimeSource = fs.readFileSync(executionRuntimePath, 'utf8');
  const deployWorkflowPath = path.join(__dirname, '..', '.github', 'workflows', 'aria-autonomy-coordinator-deploy.yml');
  const deployWorkflowSource = fs.readFileSync(deployWorkflowPath, 'utf8');
  const supabaseDeployWorkflowPath = path.join(__dirname, '..', '.github', 'workflows', 'supabase-canonical-deploy.yml');
  const supabaseDeployWorkflowSource = fs.readFileSync(supabaseDeployWorkflowPath, 'utf8');
  assert.ok(plannerSource.includes('isCloudflarePlanProducerPath(pathname)'), 'producer route guard must use the canonical runtime path matcher');
  assert.deepEqual([
    isCloudflarePlanProducerPath('/functions/v1/aria-planner-v11'),
    isCloudflarePlanProducerPath('/aria-planner-v11'),
    isCloudflarePlanProducerPath('/aria-planner-v11/'),
    isCloudflarePlanProducerPath('/functions/v1/aria-execution-runtime-v1'),
    isCloudflarePlanProducerPath('/functions/v1/aria-planner-v11/extra')
  ], [true, true, true, false, false], 'only the canonical planner endpoint forms are accepted');
  assert.equal(sanitizeCloudflarePlanFailureReason('Model output rejected: Unexpected <token> in JSON'), 'model_output_rejected_unexpected_token_in_json');
  assert.equal(sanitizeCloudflarePlanFailureReason(''), 'remote_plan_producer_rejected');
  assert.equal(sanitizeCloudflarePlanFailureReason('x'.repeat(240)).length, 160);

  // The narrow plan bridge has its own secret; runtime root auth remains separate.
  assert.ok(plannerSource.includes('Deno.env.get("ARIA_PLAN_PRODUCER_SHARED_SECRET")??"";'));
  assert.ok(plannerSource.includes('deriveCloudflarePlanPreviewToken(PLAN_BRIDGE_SECRET)'));
  assert.ok(plannerSource.includes('isCloudflarePlanProducerRequest(r,PLAN_BRIDGE_SECRET)'));
  assert.ok(executionRuntimeSource.includes('Deno.env.get("ARIA_PLAN_PRODUCER_SHARED_SECRET")??"";'));
  assert.ok(executionRuntimeSource.includes('isCloudflarePlanPreviewRequest(r,PLAN_BRIDGE_SECRET)'));
  assert.equal(executionRuntimeSource.includes('isCloudflarePlanPreviewRequest(r,SECRET)'), false);
  assert.ok(deployWorkflowSource.includes('secrets.ARIA_PLAN_PRODUCER_SHARED_SECRET'), 'Cloudflare coordinator must use the dedicated bridge secret');
  assert.equal(deployWorkflowSource.includes('secrets.ARIA_RUNTIME_SHARED_SECRET'), false, 'coordinator deploy must not depend on the legacy runtime root secret');
  assert.doesNotMatch(deployWorkflowSource, /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF|supabase secrets set|supabase functions deploy/i, 'Cloudflare coordinator must not operate the Supabase control plane');
  assert.ok(deployWorkflowSource.includes('"ARIA_PLAN_PRODUCER_TOKEN": derived'), 'only the derived HMAC token may be forwarded to Cloudflare');
  assert.equal(deployWorkflowSource.includes('"ARIA_PLAN_PRODUCER_SHARED_SECRET": derived'), false, 'the shared secret must never be forwarded to Cloudflare');
  assert.ok(supabaseDeployWorkflowSource.includes('confirm_plan_bridge_secret_sync == true'), 'canonical Supabase deploy must require a separate human confirmation');
  assert.ok(supabaseDeployWorkflowSource.includes('secrets.ARIA_PLAN_PRODUCER_SHARED_SECRET'));
  assert.ok(supabaseDeployWorkflowSource.includes('supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" --env-file "$tmp_env" --yes'));
  assert.ok(supabaseDeployWorkflowSource.includes('supabase functions deploy aria-planner-v11'));
  assert.ok(supabaseDeployWorkflowSource.includes('supabase functions deploy aria-execution-runtime-v1'));
  assert.ok(supabaseDeployWorkflowSource.indexOf('Sync dedicated plan-bridge secret and deploy planner/runtime') < supabaseDeployWorkflowSource.indexOf('Deploy canonical ARIA functions'), 'bridge secret must sync before planner/runtime publication');
  assert.ok(deployWorkflowSource.includes('if: inputs.send_telegram_test == true'));

  const secret = 'test-only-aria-runtime-secret-'.padEnd(48, 'x');
  await assert.rejects(() => deriveCloudflarePlanProducerToken('short'), /aria_plan_producer_secret_invalid/);
  await assert.rejects(() => deriveCloudflarePlanPreviewToken('short'), /aria_plan_producer_secret_invalid/);
  const producerToken = await deriveCloudflarePlanProducerToken(secret);
  assert.match(producerToken, /^[a-f0-9]{64}$/);
  assert.equal(await deriveCloudflarePlanProducerToken(secret), producerToken);
  assert.notEqual(await deriveCloudflarePlanProducerToken(secret + '!'), producerToken);

  const producerRequest = new Request('https://aria.test/functions/v1/aria-planner-v11', {
    method: 'POST',
    headers: {
      'x-aria-plan-producer': 'cloudflare-workspace-v1',
      'x-aria-plan-producer-token': producerToken
    },
    body: JSON.stringify({ goal: 'Read the project status', context: {} })
  });
  assert.equal(await isCloudflarePlanProducerRequest(producerRequest, secret), true);
  assert.equal(await isCloudflarePlanProducerRequest(producerRequest, secret + '!'), false);
  const missingMarker = new Request(producerRequest.url, {
    method: 'POST',
    headers: { 'x-aria-plan-producer-token': producerToken },
    body: '{}'
  });
  assert.equal(await isCloudflarePlanProducerRequest(missingMarker, secret), false);

  const previewToken = await deriveCloudflarePlanPreviewToken(secret);
  assert.match(previewToken, /^[a-f0-9]{64}$/);
  const previewRequest = new Request('https://aria.test/functions/v1/aria-execution-runtime-v1', {
    method: 'POST',
    headers: { 'x-aria-plan-preview-token': previewToken },
    body: '{}'
  });
  assert.equal(await isCloudflarePlanPreviewRequest(previewRequest, secret), true);
  assert.equal(await isCloudflarePlanPreviewRequest(previewRequest, secret + '!'), false);
  const wrongMethod = new Request(previewRequest.url, {
    method: 'GET',
    headers: { 'x-aria-plan-preview-token': previewToken }
  });
  assert.equal(await isCloudflarePlanPreviewRequest(wrongMethod, secret), false);

  const readRequest = {
    version: 'v1',
    allowed_operations: ['git.status', 'workspace.list', 'workspace.read'],
    workspace_context: { root: 'workspace', known_paths: ['package.json'] }
  };
  const prompt = buildCloudflareWorkspacePrompt('Inspect repository status', readRequest);
  assert.match(prompt, /READ-ONLY/);
  assert.match(prompt, /git.status/);
  assert.doesNotMatch(prompt, /workspace.write:/);

  const readPlan = buildCloudflareWorkspacePlan('Inspect repository status', readRequest, JSON.stringify({
    tasks: [
      { task_id: 'repo_status', operation: 'git.status', payload: {}, depends_on: [] },
      { task_id: 'read_manifest', operation: 'workspace.read', payload: { path: 'package.json' }, depends_on: ['repo_status'] }
    ]
  }));
  assert.equal(readPlan.tasks.length, 2);
  assert.equal(readPlan.tasks[1].depends_on[0], 'repo_status');
  assert.equal(readPlan.requires_human_approval_for_mutations, false);
  assert.equal(readPlan.planner_version, 'aria-planner-v11-cloudflare-workspace-model-v1');

  const writeRequest = {
    version: 'v1',
    allow_mutations: true,
    allowed_operations: ['workspace.write'],
    // Declares write intent so Cloudflare forces the human-approval policy.
    tasks: [{ operation: 'workspace.write' }],
    workspace_context: { approved_scope: 'temporary proof file only' }
  };
  const writePrompt = buildCloudflareWorkspacePrompt('Write a bounded proof file', writeRequest);
  assert.match(writePrompt, /require human approval/);
  const writePlan = buildCloudflareWorkspacePlan('Write a bounded proof file', writeRequest, JSON.stringify({
    tasks: [{
      task_id: 'proof_write',
      operation: 'workspace.write',
      payload: { path: 'tmp/aria-proof.txt', content: 'proof\\n' }
    }]
  }));
  assert.equal(writePlan.requires_human_approval_for_mutations, true);
  assert.equal(writePlan.tasks[0].payload.path, 'tmp/aria-proof.txt');

  assert.throws(() => buildCloudflareWorkspacePrompt('bad operation', {
    version: 'v1', allowed_operations: ['shell.execute']
  }), /plan_operation_rejected/);
  assert.throws(() => buildCloudflareWorkspacePrompt('mutation without authorization', {
    version: 'v1', allowed_operations: ['workspace.write']
  }), /workspace_mutations_not_explicitly_allowed/);
  assert.throws(() => buildCloudflareWorkspacePrompt('mutation without explicit declaration', {
    version: 'v1', allow_mutations: true, allowed_operations: ['workspace.write']
  }), /workspace_mutation_intent_hint_required/);
  assert.throws(() => buildCloudflareWorkspacePlan('path escape', readRequest, JSON.stringify({
    tasks: [{ task_id: 'bad', operation: 'workspace.read', payload: { path: '../secrets.txt' } }]
  })), /workspace_path_policy_blocked/);
  assert.throws(() => buildCloudflareWorkspacePlan('sensitive path', readRequest, JSON.stringify({
    tasks: [{ task_id: 'bad', operation: 'workspace.read', payload: { path: '.env' } }]
  })), /workspace_path_policy_blocked/);
  assert.throws(() => buildCloudflareWorkspacePlan('unrequested write', readRequest, JSON.stringify({
    tasks: [{ task_id: 'bad', operation: 'workspace.write', payload: { path: 'a.txt', content: 'x' } }]
  })), /plan_operation_rejected/);
  assert.throws(() => buildCloudflareWorkspacePlan('bad dependency', readRequest, JSON.stringify({
    tasks: [{ task_id: 'one', operation: 'git.status', depends_on: ['later'] }]
  })), /plan_dependency_invalid/);
  assert.throws(() => buildCloudflareWorkspacePlan('bad test path', {
    version: 'v1', allowed_operations: ['tests.run']
  }, JSON.stringify({
    tasks: [{ task_id: 'one', operation: 'tests.run', payload: { test_file: 'scripts/run.js' } }]
  })), /test_file_policy_blocked/);
  assert.throws(() => buildCloudflareWorkspacePlan('invalid JSON', readRequest, 'no json'), /planner_model_output_not_json/);

  process.stdout.write('CLOUDFLARE_WORKSPACE_PLAN_MODEL_CONTRACT=PASS\\n');
  process.stdout.write('CLOUDFLARE_PLAN_PRODUCER_HMAC_AUTH=PASS\\n');
  process.stdout.write('CLOUDFLARE_PLAN_PREVIEW_HMAC_AUTH=PASS\\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
