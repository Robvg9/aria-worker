'use strict';

const assert = require('node:assert');
const { listDevices } = require('../devices/registry');
const { createDeviceRuntime, selectDevice } = require('../devices/runtime-v1');

const resources = listDevices();
assert.strictEqual(resources.length, 7);
assert.strictEqual(new Set(resources.map(r => r.resource_class)).size, 7);
for (const resource of resources) {
  assert.ok(resource.device_id);
  assert.ok(Array.isArray(resource.capabilities));
  assert.strictEqual(resource.health, 'unknown');
  assert.strictEqual(resource.security, 'restricted');
  assert.ok(resource.executor);
}

const chosen = selectDevice({
  capability: 'screen.capture',
  observed: {
    device_android_runtime: { health: 'healthy', security: 'restricted', provenance: 'live-cert' }
  }
});
assert.strictEqual(chosen.status, 'succeeded');
assert.strictEqual(chosen.resource.resource_class, 'mobile');
assert.ok(chosen.resource.capabilities.includes('screen.capture'));

const unobserved = selectDevice({ capability: 'screen.capture' });
assert.strictEqual(unobserved.status, 'blocked');
assert.strictEqual(unobserved.reason, 'no_healthy_device');

const cognitionInputs = [];
const runtime = createDeviceRuntime({
  executors: {
    'pc-runtime': {
      observe: async device => ({ health: 'healthy', security: 'trusted', telemetry: 'ok', executor_seen: device.executor }),
      execute: async (device, operation, input) => ({ resource_class: device.resource_class, operation, input })
    }
  },
  cognition: async resource => { cognitionInputs.push(resource); return { capability_count: resource.capabilities.length, class: resource.resource_class }; },
  authorize: async () => ({ status: 'approved' })
});

(async () => {
  const before = await runtime.perceiveForCognition('device_pc_runtime', { health: 'healthy', security: 'trusted' });
  assert.strictEqual(before.cognition.class, 'desktop');
  assert.ok(cognitionInputs[0].capabilities.includes('shell.execute'));
  const observed = await runtime.observe('device_pc_runtime', 'screen.capture');
  assert.strictEqual(observed.status, 'succeeded');
  assert.strictEqual(observed.resource.health, 'healthy');
  assert.strictEqual(observed.resource.security, 'trusted');
  const executed = await runtime.execute({ device_id: 'device_pc_runtime', operation: 'screen.capture', input: { capture: 'ui' }, authorization: { evidence: 'live-cert' } });
  assert.strictEqual(executed.status, 'succeeded');
  assert.strictEqual(executed.result.resource_class, 'desktop');
  const blocked = await runtime.execute({ device_id: 'device_pc_runtime', operation: 'cloud.deploy', input: {} , authorization: { evidence: 'live-cert' }});
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(blocked.reason, 'capability_unavailable');
  const denied = createDeviceRuntime({
    executors: { 'pc-runtime': { execute: async () => ({ ok: true }) } },
    authorize: async () => ({ status: 'denied' })
  });
  const gate = await denied.execute({ device_id: 'device_pc_runtime', operation: 'shell.execute', input: { command: 'echo blocked' }, authorization: {} });
  assert.strictEqual(gate.status, 'blocked');
  assert.strictEqual(gate.reason, 'authorization_required');
  console.log('ARIA_DEVICE_UNIVERSE_1_LIVE_OK');
  console.log('DEVICE UNIVERSE V1 LIVE: PASS — 7 resource classes, capability routing, observed health, security gate, cognition abstraction and governed executor');
})().catch(error => { console.error(error); process.exit(1); });
