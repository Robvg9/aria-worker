'use strict';

const assert = require('node:assert/strict');
const { runPreflight, readConfig } = require('./aria-persistent-windows-worker-preflight-v1');

const workerToken = 'worker-token-never-print-this-value-0123456789';
const baseEnv = Object.freeze({
  ARIA_CONTROL_URL: 'https://aria-autonomy-coordinator.robvg9.workers.dev',
  ARIA_WORKER_TOKEN: workerToken,
  ARIA_AUTONOMY_ADAPTER: 'D:\\Databank\\aria-worker-package4\\autonomy\\aria-windows-execution-adapter-v1.js',
  ARIA_WORKSPACE_ROOT: 'D:\\Databank\\aria-worker-package4'
});

function adapterLoader() {
  return {
    createAdapter(options) {
      assert.equal(options.workspaceRoot, baseEnv.ARIA_WORKSPACE_ROOT);
      assert.deepEqual(Object.keys(options), ['workspaceRoot']);
      return {
        supabaseIndependent: true,
        localInference: false,
        capabilities: ['workspace.write', 'mission.verify'],
        health: async () => ({ ok: true, local_inference: false }),
        executeTask: async () => ({ passed: true, evidence: { created: true } }),
        verifyCompletion: async () => ({ passed: true })
      };
    }
  };
}

async function testReadOnlyPreflightPassesWithoutLocalModel() {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({
        ok: true,
        service: 'aria-autonomy-coordinator',
        supabase_independent: true
      }), { status: 200 });
    }
    if (!options.headers || !options.headers.authorization) {
      return new Response('{"error":"unauthorized_worker"}', { status: 401 });
    }
    assert.equal(options.headers.authorization, 'Bearer ' + workerToken);
    return new Response('{"error":"mission_execution_paused"}', { status: 423 });
  };

  const result = await runPreflight({ env: baseEnv, fetchImpl, adapterLoader });
  assert.equal(result.ok, true);
  assert.equal(result.local_inference, false);
  assert.equal(result.adapter, 'aria-windows-execution-v1');
  assert.deepEqual(Object.values(result.checks), ['pass', 'pass', 'pass', 'pass', 'pass']);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.method), ['GET', 'GET', 'GET']);
  assert.ok(requests.every(request => request.redirect === 'error'));
  assert.ok(requests.every(request => request.body === undefined));
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[1].headers.authorization, undefined);
  assert.equal(requests[2].headers.authorization, 'Bearer ' + workerToken);
  assert.ok(!JSON.stringify(result).includes(workerToken), 'preflight output must not contain the worker token');
  assert.ok(!JSON.stringify(result).toLowerCase().includes('ollama'));
}

async function testRejectsInsecureOrCredentialBearingUrlsBeforeNetwork() {
  for (const url of [
    'http://aria-autonomy-coordinator.robvg9.workers.dev',
    'https://user:password@example.com',
    'https://example.com/path',
    'https://example.com/?token=secret',
    'not a url'
  ]) {
    assert.throws(() => readConfig({ ...baseEnv, ARIA_CONTROL_URL: url }), /ARIA_CONTROL_URL/);
  }
}

async function testRejectsShortTokenBeforeNetwork() {
  assert.throws(() => readConfig({ ...baseEnv, ARIA_WORKER_TOKEN: 'short' }), /ARIA_WORKER_TOKEN/);
}

async function testRejectsInvalidHealthContract() {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('{"ok":true,"service":"other","supabase_independent":true}', { status: 200 });
  };
  await assert.rejects(
    () => runPreflight({ env: baseEnv, fetchImpl, adapterLoader }),
    /coordinator_health_contract_invalid/
  );
  assert.equal(calls, 1);
}

async function testRejectsInvalidWorkerTokenWithoutMutation() {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({
        ok: true, service: 'aria-autonomy-coordinator', supabase_independent: true
      }), { status: 200 });
    }
    if (!options.headers || !options.headers.authorization) return new Response('{}', { status: 401 });
    return new Response('{"error":"unauthorized_worker"}', { status: 401 });
  };
  await assert.rejects(
    () => runPreflight({ env: baseEnv, fetchImpl, adapterLoader }),
    /coordinator_status_mismatch:worker_token_accepted_and_global_freeze_enforced:expected_423:received_401/
  );
  assert.equal(calls, 3);
}

async function testRejectsAnyLocalInferenceAdapterBeforeNetwork() {
  let calls = 0;
  const localModelLoader = () => ({
    createAdapter: () => ({
      supabaseIndependent: true,
      localInference: true,
      health: async () => ({ ok: true, local_inference: true }),
      executeTask: async () => ({ passed: true }),
      verifyCompletion: async () => ({ passed: true })
    })
  });
  await assert.rejects(
    () => runPreflight({
      env: baseEnv,
      fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
      adapterLoader: localModelLoader
    }),
    /worker_adapter_must_be_execution_only_without_local_inference/
  );
  assert.equal(calls, 0, 'local inference adapter must be rejected before any network request');
}

(async () => {
  await testReadOnlyPreflightPassesWithoutLocalModel();
  await testRejectsInsecureOrCredentialBearingUrlsBeforeNetwork();
  await testRejectsShortTokenBeforeNetwork();
  await testRejectsInvalidHealthContract();
  await testRejectsInvalidWorkerTokenWithoutMutation();
  await testRejectsAnyLocalInferenceAdapterBeforeNetwork();
  process.stdout.write('persistent-worker-preflight-v1: all tests passed (no local inference)\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
