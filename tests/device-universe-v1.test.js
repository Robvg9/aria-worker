'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VERSION, listDevices, getDevice, devicesByCapability, capabilitiesOf } = require('../devices/registry');
const { deviceResource, selectDevice, createDeviceRuntime } = require('../devices/runtime-v1');

const registryText = fs.readFileSync(path.join(__dirname, '..', 'devices', 'registry.json'), 'utf8');

assert.strictEqual(VERSION, 'aria-device-registry-v1.0.0');
const all = listDevices();
assert.strictEqual(all.length, 7);
assert.strictEqual(new Set(all.map(d => d.device_id)).size, 7);
assert.ok(all.some(d => d.resource_class === 'mobile'));
assert.ok(all.some(d => d.resource_class === 'desktop'));
assert.ok(all.some(d => d.resource_class === 'browser'));
assert.ok(all.some(d => d.resource_class === 'cloud_runtime'));
assert.ok(all.some(d => d.resource_class === 'database_runtime'));
assert.ok(all.some(d => d.resource_class === 'local_runtime'));
assert.ok(all.some(d => d.resource_class === 'iot'));
assert.ok(devicesByCapability('screen.capture').length >= 2);
assert.ok(capabilitiesOf('device_android_runtime').includes('ui.observe'));
assert.strictEqual(getDevice('missing'), null);
assert.ok(!registryText.match(/(?:AIza|sk-|gh[pousr]_)/i));

const resource = deviceResource('device_android_runtime', { health: 'healthy', provenance: 'observed:test' });
assert.strictEqual(resource.resource_id, 'device_android_runtime');
assert.strictEqual(resource.resource_class, 'mobile');
assert.ok(resource.capabilities.includes('screen.capture'));
assert.strictEqual(resource.health, 'healthy');
assert.strictEqual(resource.provenance, 'observed:test');
assert.ok(resource.observation_id.startsWith('obs_'));
assert.throws(() => deviceResource('device_android_runtime', { token: 'bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ' }), /secret_material_rejected/);

const selected = selectDevice({ capability: 'screen.capture', observed: { device_android_runtime: { health: 'healthy', security: 'restricted' } } });
assert.strictEqual(selected.status, 'succeeded');
assert.strictEqual(selected.resource.resource_class, 'mobile');
const blocked = selectDevice({ capability: 'screen.capture' });
assert.strictEqual(blocked.status, 'blocked');
assert.strictEqual(blocked.reason, 'no_healthy_device');
const unavailable = selectDevice({ capability: 'database.query', require_healthy: false, preferred_device_id: 'device_android_runtime' });
assert.strictEqual(unavailable.status, 'blocked');
assert.strictEqual(unavailable.reason, 'no_eligible_device');

const calls = [];
const runtime = createDeviceRuntime({
  executors: {
    'android-runtime': {
      observe: async (device, operation) => ({ health: 'healthy', security: 'restricted', operation, source: device.executor }),
      execute: async (device, operation, input) => { calls.push({ device: device.resource_class, operation, input }); return { ok: true, operation }; }
    }
  },
  authorize: async ({ operation }) => operation === 'screen.capture' ? { status: 'approved' } : { status: 'denied' },
  cognition: async resource => ({ selected_by: resource.resource_id, capabilities: resource.capabilities.length })
});

(async () => {
  const observed = await runtime.observe('device_android_runtime', 'screen.capture');
  assert.strictEqual(observed.status, 'succeeded');
  assert.strictEqual(observed.resource.health, 'healthy');
  assert.strictEqual(observed.observation.operation, 'screen.capture');
  const cognized = await runtime.perceiveForCognition('device_android_runtime', { health: 'healthy' });
  assert.strictEqual(cognized.status, 'succeeded');
  assert.strictEqual(cognized.cognition.selected_by, 'device_android_runtime');
  const executed = await runtime.execute({ device_id: 'device_android_runtime', operation: 'screen.capture', input: { mode: 'semantic' }, authorization: { review_id: 'r1' } });
  assert.strictEqual(executed.status, 'succeeded');
  assert.strictEqual(calls.length, 1);
  const denied = await runtime.execute({ device_id: 'device_android_runtime', operation: 'shell.execute', input: { command: 'echo x' }, authorization: { review_id: 'r2' } });
  assert.strictEqual(denied.status, 'blocked');
  assert.strictEqual(denied.reason, 'authorization_required');
  const unknown = await runtime.observe('missing', 'screen.capture');
  assert.strictEqual(unknown.status, 'blocked');
  assert.strictEqual(unknown.reason, 'device_not_found');
  const badOp = await runtime.observe('device_android_runtime', 'cloud.deploy');
  assert.strictEqual(badOp.status, 'blocked');
  assert.strictEqual(badOp.reason, 'capability_unavailable');
  console.log('DEVICE UNIVERSE V1: PASS — registry, capabilities, health, security, abstraction and governed execution');
})().catch(error => { console.error(error); process.exit(1); });
