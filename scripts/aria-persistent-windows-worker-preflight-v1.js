'use strict';

// Mutation-free, one-shot preflight for the real Windows worker configuration.
// It checks local Ollama readiness and the remote coordinator's worker-auth
// boundary using GET requests only. It never claims a job or changes mission state.
const path = require('node:path');

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:4b';
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
    workspaceRoot,
    ollamaUrl: String(env.ARIA_OLLAMA_URL || DEFAULT_OLLAMA_URL),
    model: String(env.ARIA_OLLAMA_MODEL || DEFAULT_MODEL)
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
    adapter = adapterModule.createAdapter({
      workspaceRoot: config.workspaceRoot,
      ollamaUrl: config.ollamaUrl,
      model: config.model
    });
  }

  if (!adapter || adapter.supabaseIndependent !== true) throw new Error('worker_adapter_must_declare_supabase_independent');
  for (const method of ['health', 'plan', 'replan', 'executeTask', 'verifyCompletion']) {
    if (typeof adapter[method] !== 'function') throw new Error('worker_adapter_method_missing:' + method);
  }

  const localHealth = await adapter.health();
  if (!localHealth || localHealth.ok !== true) throw new Error('ollama_local_model_not_ready');
  const model = String(localHealth.model || adapter.model || config.model);

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

  // Both requests are GETs to the claim route. The coordinator checks the
  // worker token before rejecting the method with 405; no claim body is read,
  // no Durable Object storage is changed, and no lease can be created.
  await expectStatus(
    fetchImpl,
    config.baseUrl + '/api/worker/claim',
    401,
    {},
    'worker_auth_required'
  );
  await expectStatus(
    fetchImpl,
    config.baseUrl + '/api/worker/claim',
    405,
    { authorization: 'Bearer ' + config.token },
    'worker_token_accepted_read_only'
  );

  return Object.freeze({
    ok: true,
    coordinator: config.baseUrl,
    model,
    checks: Object.freeze({
      local_ollama: 'pass',
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
    process.stdout.write('ARIA_WINDOWS_PREFLIGHT_MODEL=' + result.model + '\n');
    for (const [name, status] of Object.entries(result.checks)) {
      process.stdout.write('ARIA_WINDOWS_PREFLIGHT_CHECK_' + name.toUpperCase() + '=' + status.toUpperCase() + '\n');
    }
  }).catch(error => {
    process.stderr.write('ARIA_WINDOWS_PREFLIGHT_FAIL=' + String(error && error.message || 'unknown') + '\n');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ runPreflight, readConfig });
