'use strict';

const assert = require('node:assert/strict');
const { runPreflight, readConfig } = require('./aria-persistent-windows-worker-preflight-v1');

const workerToken = 'worker-token-never-print-this-value-0123456789';
const baseEnv = Object.freeze({
  ARIA_CONTROL_URL: 'https://aria-autonomy-coordinator.robvg9.workers.dev',
  ARIA_WORKER_TOKEN: workerToken,
  ARIA_AUTONOMY_ADAPTER: 'C:\\aria\\autonomy\\ollama-persistent-adapter-v1.js',
  ARIA_WORKSPACE_ROOT: 'D:\\Databank\\aria-preflight-workspace',
  ARIA_OLLAMA_URL: 'http://127.0.0.1:11434',
  ARIA_OLLAMA_MODEL: 'qwen3:4b'
});

function adapterLoader() {
  return {
    createAdapter(options) {
      assert.equal(options.workspaceRoot, baseEnv.ARIA_WORKSPACE_ROOT);
      assert.equal(options.ollamaUrl, baseEnv.ARIA_OLLAMA_URL);
      assert.equal(options.model, baseEnv.ARIA_OLLAMA_MODEL);
      return {
        supabaseIndependent: true,
        model: options.model,
        health: async () => ({ ok: true, model: options.model }),
        plan: async () => [],
        replan: async () => [],
        executeTask: async () => ({ passed: true }),
        verifyCompletion: async () => ({ passed: true })
      };
    }
  };
}

async function testReadOnlyPreflightPasses() {
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
    if (!options.headers || !options.headers.authorization) return new Response('{"error":"unauthorized_worker"}', { status: 401 });
    assert.equal(options.headers.authorization, 'Bearer ' + workerToken);
    return new Response('{"error":"method_not_allowed"}', { status: 405 });
  };

  const result = await runPreflight({ env: baseEnv, fetchImpl, adapterLoader });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'qwen3:4b');
  assert.deepEqual(Object.values(result.checks), ['pass', 'pass', 'pass', 'pass']);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.method), ['GET', 'GET', 'GET']);
  assert.ok(requests.every(request => request.redirect === 'error'));
  assert.ok(requests.every(request => request.body === undefined));
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[1].headers.authorization, undefined);
  assert.equal(requests[2].headers.authorization, 'Bearer ' + workerToken);
  assert.ok(!JSON.stringify(result).includes(workerToken), 'preflight output must not contain the worker token');
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
  assert.equal(calls, 1, 'preflight must stop before worker-auth probes when health is invalid');
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
    /coordinator_status_mismatch:worker_token_accepted_read_only:expected_405:received_401/
  );
  assert.equal(calls, 3);
}

async function testRequiresReadyLocalModel() {
  let calls = 0;
  const notReadyAdapterLoader = () => ({
    createAdapter: () => ({
      supabaseIndependent: true,
      health: async () => ({ ok: false, model: 'qwen3:4b' }),
      plan: async () => [],
      replan: async () => [],
      executeTask: async () => ({ passed: true }),
      verifyCompletion: async () => ({ passed: true })
    })
  });
  await assert.rejects(
    () => runPreflight({
      env: baseEnv,
      fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
      adapterLoader: notReadyAdapterLoader
    }),
    /ollama_local_model_not_ready/
  );
  assert.equal(calls, 0, 'do not contact the coordinator when the local model is not ready');
}

(async () => {
  await testReadOnlyPreflightPasses();
  await testRejectsInsecureOrCredentialBearingUrlsBeforeNetwork();
  await testRejectsShortTokenBeforeNetwork();
  await testRejectsInvalidHealthContract();
  await testRejectsInvalidWorkerTokenWithoutMutation();
  await testRequiresReadyLocalModel();
  process.stdout.write('persistent-worker-preflight-v1: all tests passed\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
