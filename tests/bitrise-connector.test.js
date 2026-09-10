'use strict';

const assert = require('node:assert/strict');
const { adapters } = require('../activation/connectors');
const { DEFAULT_MANIFEST, normalizeManifest } = require('../activation/config');
const { TRUSTED_BASE_URLS, isSecretRef, validateConnectorConfig, RISK_CLASSES } = require('../activation/contract');
const { createActivationRuntime } = require('../activation/runtime');

const bitrise = adapters.bitrise;
assert.ok(bitrise, 'bitrise adapter registered');
assert.equal(bitrise.descriptor.connector_id, 'bitrise');
assert.deepEqual(
  bitrise.descriptor.operations.sort(),
  [
    'bitrise_get_app',
    'bitrise_get_artifact',
    'bitrise_get_build',
    'bitrise_get_build_log',
    'bitrise_get_yml',
    'bitrise_list_apps',
    'bitrise_list_artifacts',
    'bitrise_list_builds',
    'bitrise_trigger_build',
    'bitrise_update_yml',
  ].sort(),
);
assert.equal(bitrise.descriptor.operation_risk.bitrise_list_apps, 'READ');
assert.equal(bitrise.descriptor.operation_risk.bitrise_trigger_build, 'LOW_RISK_WRITE');
assert.equal(bitrise.descriptor.operation_risk.bitrise_update_yml, 'HIGH_RISK_WRITE');

const entry = DEFAULT_MANIFEST.find((e) => e.connector_id === 'bitrise');
assert.ok(entry, 'bitrise present in DEFAULT_MANIFEST');
assert.equal(entry.credential_ref, 'secret://bitrise/default');
assert.equal(entry.base_url, 'https://api.bitrise.io/v0.1');
assert.equal(isSecretRef(entry.credential_ref), true);
assert.equal(TRUSTED_BASE_URLS.bitrise, 'https://api.bitrise.io/v0.1');
assert.equal(validateConnectorConfig({ ...entry, enabled: true }).valid, true);

assert.equal(JSON.stringify(bitrise.descriptor).includes('token'), false, 'descriptor must not embed token material');
assert.equal(JSON.stringify(DEFAULT_MANIFEST).includes('bitrise_api_token'), false);

(async () => {
  const captured = [];
  const fakeFetch = async (url, options = {}) => {
    captured.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ data: [{ slug: 'aria-app-slug', title: 'aria-app' }] });
      },
    };
  };

  const authorizeAlways = async () => ({ status: 'approved', approved_to_execute: true });
  const authorizeDeny = async () => ({ status: 'blocked', reason: 'human_gate_required' });

  const runtime = createActivationRuntime({
    manifest: normalizeManifest([
      { connector_id: 'bitrise', credential_ref: 'secret://bitrise/default', base_url: 'https://api.bitrise.io/v0.1', enabled: true, required: false },
      { connector_id: 'web', credential_ref: null, base_url: null, enabled: true, required: false },
    ]),
    env: { ARIA_SECRET_BITRISE_DEFAULT: 'TEST_TOKEN_VALUE_NOT_FOR_PRODUCTION' },
    fetchImpl: fakeFetch,
    authorize: authorizeAlways,
  });

  await runtime.probe({ connector_id: 'bitrise', credential_ref: 'secret://bitrise/default', base_url: 'https://api.bitrise.io/v0.1', enabled: true, required: false });
  assert.equal(runtime.status('bitrise'), 'healthy');

  const readResult = await runtime.execute('bitrise', 'bitrise_list_apps', { risk_class: 'READ' });
  assert.equal(readResult.status, 'succeeded');
  assert.equal(readResult.connector_id, 'bitrise');
  assert.ok(readResult.data);
  const serialized = JSON.stringify(readResult);
  assert.equal(serialized.includes('TEST_TOKEN_VALUE_NOT_FOR_PRODUCTION'), false, 'token must never appear in adapter result');
  assert.equal(serialized.includes('Authorization'), false);

  const highRiskBlocked = createActivationRuntime({
    manifest: normalizeManifest([
      { connector_id: 'bitrise', credential_ref: 'secret://bitrise/default', base_url: 'https://api.bitrise.io/v0.1', enabled: true, required: false },
    ]),
    env: { ARIA_SECRET_BITRISE_DEFAULT: 'TEST_TOKEN_VALUE_NOT_FOR_PRODUCTION' },
    fetchImpl: fakeFetch,
    authorize: authorizeDeny,
  });
  await highRiskBlocked.probe({ connector_id: 'bitrise', credential_ref: 'secret://bitrise/default', base_url: 'https://api.bitrise.io/v0.1', enabled: true, required: false });
  const updateBlocked = await highRiskBlocked.execute('bitrise', 'bitrise_update_yml', {
    risk_class: 'HIGH_RISK_WRITE',
    app_slug: 'aria-app-slug',
    yml: { format_version: '11' },
  });
  assert.equal(updateBlocked.status, 'blocked');
  assert.equal(updateBlocked.reason, 'authorization_not_approved');

  const unknown = await runtime.execute('unknown_connector_xyz', 'health', {});
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.reason, 'connector_unknown');

  const webRuntime = createActivationRuntime({
    manifest: normalizeManifest([{ connector_id: 'web', credential_ref: null, base_url: null, enabled: true, required: false }]),
    env: {},
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return '{"ok":true}'; } }),
    authorize: authorizeAlways,
  });
  await webRuntime.probe({ connector_id: 'web', credential_ref: null, base_url: null, enabled: true, required: false });
  const webResult = await webRuntime.execute('web', 'fetch', { risk_class: 'READ', url: 'https://example.com' });
  assert.equal(webResult.status, 'succeeded');

  const adapterResult = await bitrise.execute('bitrise_list_apps', {
    secret: 'TEST_TOKEN_VALUE_NOT_FOR_PRODUCTION',
    base_url: 'https://api.bitrise.io/v0.1',
    fetchImpl: fakeFetch,
  });
  assert.equal(adapterResult.ok, true);
  assert.equal(JSON.stringify(adapterResult).includes('TEST_TOKEN_VALUE_NOT_FOR_PRODUCTION'), false);

  const authCall = captured.find((c) => c.url.includes('/apps') && !c.url.includes('/me'));
  assert.ok(authCall);
  assert.equal(authCall.headers.Authorization, 'TEST_TOKEN_VALUE_NOT_FOR_PRODUCTION');

  console.log('BITRISE CONNECTOR: PASS — descriptor, credential ref, READ allowed, HIGH_RISK_WRITE gated, token redacted, unknown rejected, existing connectors intact');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
