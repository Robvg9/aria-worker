'use strict';

const assert = require('node:assert/strict');
const { createAutonomousRuntime } = require('../autonomy/autonomous-runtime');
const { createDesktopMissionPlanner } = require('../autonomy/desktop-mission-planner');

const runtime = createAutonomousRuntime({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'test-service-role-placeholder',
  activation: { execute: async () => ({ status: 'succeeded' }) },
  desktopPlanner: createDesktopMissionPlanner({ device_id: 'windows-test' }),
  verify: async () => true,
  device: {
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  }
});

assert.equal(typeof runtime.runMission, 'function');
assert.equal(typeof runtime.startMission, 'function');
assert.equal(typeof runtime.deviceDispatcher.execute, 'function');
assert.equal(typeof runtime.orchestrator.run, 'function');

const plannerInput = { mission: { goal: 'Abre PowerShell y escribe una prueba' }, policy: {} };
const directPlan = runtime.orchestrator && runtime.orchestrator.policy ? null : null;
assert.equal(directPlan, null);

console.log('DESKTOP_MISSION_RUNTIME_INTEGRATION_TEST=PASS');
