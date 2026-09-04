'use strict';
const assert = require('assert');
const { createServiceDeviceClient } = require('../execution/live-device-client');

(async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  };
  const client = createServiceDeviceClient({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key',
    fetchImpl
  });
  await client.enqueue({
    job_id: 'j1', mission_id: 'm1', device_id: 'd1', operation: 'shell.execute',
    command: 'echo ok', timeout_ms: 1000, policy: { risk: 'low' }, metadata: { test: true }
  });
  await client.get('j1');
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/enqueue_execution_job_gateway'));
  assert.ok(calls[1].url.endsWith('/rest/v1/rpc/get_execution_job_gateway'));
  assert.strictEqual(calls[0].options.headers.apikey, 'test-service-role-key');
  assert.strictEqual(JSON.parse(calls[0].options.body).p_command, 'echo ok');
  console.log('live device client tests passed');
})().catch(error => { console.error(error); process.exit(1); });
