'use strict';

// Mutation-free preflight for the execution-only Windows worker.
// The local adapter performs bounded workspace operations only. Planning and
// semantic reasoning are remote responsibilities; this preflight never loads
// a model, calls Ollama, claims a job, or changes mission state.
const path = require('node:path');

const PREFLIGHT_TIMEOUT_MS = 10000;

function readConfig(env) {
  const rawUrl = String(env.ARIA_CONTROL_URL || '').trim();
  if (!rawUrl) throw new Error('ARIA_CONTROL_URL_required');

  let parsed;
  try { parsed = new URL(rawUrl); }
  catch (_) { throw new Error('ARIA_CONTROL_URL_invalid'); }

  if (parsed.protocol !== 'https:') throw new Error('ARIA_CONTROL_URL_must_use_https');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('ARIA_CONTROL_URL_must_not_contain_credentials_query_or_fragment');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('ARIA_CONTROL_URL_must_be_an_origin_without_a_path');
  }

  const token = String(env.ARIA_WORKER_TOKEN || '');
  if (token.length < 32) throw new Error('ARIA_WORKER_TOKEN_must_contain_at_least_32_characters');

  const adapterPath = String(env.ARIA_AUTONOMY_ADAPTER || '').trim();
  if (!adapterPath) throw new Error('ARIA_AUTONOMY_ADAPTER_required');

  const workspaceRoot = String(env.ARIA_WORKSPACE_ROOT || '').trim();
  if (!workspaceRoot) throw new Error('ARIA_WORKSPACE_ROOT_required');

  return {
    baseUrl: parsed.origin,
    token,
    adapterPath: path.resolve(adapterPath),
    workspaceRoot
  };
}

async function expectStatus(fetchImpl, url, expectedStatus, headers = {}, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS)
    });
  } catch (_) {
    throw new Error('coordinator_request_failed:' + label);
  }
  if (response.status !== expectedStatus) {
    throw new Error('coordinator_status_mismatch:' + label + ':expected_' + expectedStatus + ':received_' + response.status);
  }
  return response;
}

async function runPreflight({
  env = process.env,
  fetchImpl = global.fetch,
  adapterLoader = require
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const config = readConfig(env);
  const adapterModule = adapterLoader(config.adapterPath);
  let adapter = adapterModule;
  if (adapterModule && typeof adapterModule.createAdapter === 'function' && adapterModule.supabaseIndependent !== true) {
    adapter = adapterModule.createAdapter({ workspaceRoot: config.workspaceRoot });
  }

  if (!adapter || adapter.supabaseIndependent !== true ||
      adapter.localInference !== false ||
      typeof adapter.plan === 'function' ||
      typeof adapter.replan === 'function') {
    throw new Error('worker_adapter_must_be_execution_only_without_local_inference_or_planner');
  }
  for (const method of ['health', 'executeTask', 'verifyCompletion']) {
    if (typeof adapter[method] !== 'function') throw new Error('worker_adapter_method_missing:' + method);
  }

  const localHealth = await adapter.health();
  if (!localHealth || localHealth.ok !== true || localHealth.local_inference !== false) {
    throw new Error('local_execution_adapter_not_ready_or_local_inference_enabled');
  }

  const healthResponse = await expectStatus(
    fetchImpl,
    config.baseUrl + '/health',
    200,
    {},
    'health'
  );
  let health;
  try { health = await healthResponse.json(); }
  catch (_) { throw new Error('coordinator_health_json_invalid'); }
  if (!health || health.ok !== true ||
      health.service !== 'aria-autonomy-coordinator' ||
      health.supabase_independent !== true) {
    throw new Error('coordinator_health_contract_invalid');
  }

  // Both requests are GETs to the claim route. An unauthenticated worker is
  // rejected with 401; the authenticated worker reaches the global freeze gate
  // and receives 423 mission_execution_paused before method dispatch. GET never
  // reads a request body, mutates Durable Object storage, or creates a lease.
  await expectStatus(
    fetchImpl,
    config.baseUrl + '/api/worker/claim',
    401,
    {},
    'worker_auth_required'
  );
  const authenticatedClaimResponse = await expectStatus(
    fetchImpl,
    config.baseUrl + '/api/worker/claim',
    423,
    { authorization: 'Bearer ' + config.token },
    'worker_token_accepted_and_global_freeze_enforced'
  );
  let claimGate;
  try { claimGate = await authenticatedClaimResponse.json(); }
  catch (_) { throw new Error('worker_claim_freeze_json_invalid'); }
  if (!claimGate || claimGate.error !== 'mission_execution_paused') {
    throw new Error('worker_claim_freeze_contract_invalid');
  }

  return Object.freeze({
    ok: true,
    coordinator: config.baseUrl,
    adapter: 'aria-windows-execution-v1',
    local_inference: false,
    checks: Object.freeze({
      local_workspace_executor: 'pass',
      local_inference_disabled: 'pass',
      coordinator_health: 'pass',
      unauthenticated_worker_rejected: 'pass',
      authenticated_worker_read_only: 'pass'
    })
  });
}

if (require.main === module) {
  runPreflight().then(result => {
    process.stdout.write('ARIA_WINDOWS_PREFLIGHT_PASS=true\n');
    process.stdout.write('ARIA_WINDOWS_PREFLIGHT_COORDINATOR=' + result.coordinator + '\n');
    process.stdout.write('ARIA_WINDOWS_PREFLIGHT_ADAPTER=' + result.adapter + '\n');
    process.stdout.write('ARIA_WINDOWS_PREFLIGHT_LOCAL_INFERENCE=false\n');
    for (const [name, status] of Object.entries(result.checks)) {
      process.stdout.write('ARIA_WINDOWS_PREFLIGHT_CHECK_' + name.toUpperCase() + '=' + status.toUpperCase() + '\n');
    }
  }).catch(error => {
    process.stderr.write('ARIA_WINDOWS_PREFLIGHT_FAIL=' + String(error && error.message || 'unknown') + '\n');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ runPreflight, readConfig });
