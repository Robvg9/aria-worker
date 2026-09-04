'use strict';

const assert = require('assert');
const { createAutonomousRuntime } = require('../autonomy/autonomous-runtime');

const activation = { execute: async () => ({ status: 'succeeded' }) };
const planner = async () => [];
const verify = async () => true;

assert.throws(() => createAutonomousRuntime(), /activation runtime required/);
assert.throws(() => createAutonomousRuntime({ activation }), /planner function required/);
assert.throws(() => createAutonomousRuntime({ activation, planner }), /verify function required/);

const runtime = createAutonomousRuntime({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'not-a-real-secret',
  activation,
  planner,
  verify,
  policy: { enabled: true }
});

assert.strictEqual(typeof runtime.runMission, 'function');
assert.strictEqual(typeof runtime.orchestrator.run, 'function');
assert.strictEqual(typeof runtime.executor.execute, 'function');
assert.strictEqual(typeof runtime.deviceDispatcher.execute, 'function');
assert.strictEqual(typeof runtime.missionStore.get, 'function');
assert.strictEqual(typeof runtime.missionStore.transition, 'function');
assert.strictEqual(typeof runtime.missionStore.checkpoint, 'function');

console.log('Autonomous runtime assembly: PASS');
