'use strict';

const assert = require('node:assert/strict');
const { createAutonomousRuntime } = require('../autonomy/autonomous-runtime');
const { createDesktopMissionPlanner } = require('../autonomy/desktop-mission-planner');

const runtime = createAutonomousRuntime({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'test-service-role-placeholder',
  activation: { execute: async () => ({ status: 'succeeded' }) },
  planner: async () => [],
  desktopPlanner: createDesktopMissionPlanner({ device_id: 'windows-test' }),
  desktopSemanticVerification: true,
  desktopReplanning: true,
  verify: async () => true,
  device: { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }
});

assert.equal(typeof runtime.runMission, 'function');
assert.equal(typeof runtime.startMission, 'function');
assert.equal(typeof runtime.deviceDispatcher.execute, 'function');
assert.equal(typeof runtime.orchestrator.run, 'function');
assert.equal(runtime.desktop.semantic_verification, true);
assert.equal(runtime.desktop.replanning, true);
assert.equal(runtime.desktop.planner.version.startsWith('aria-desktop-mission-planner-'), true);

const plan = runtime.desktop.planner.plan({ goal: 'Abre PowerShell y verifica el estado' });
assert.equal(plan.status, 'planned');
assert.equal(plan.target.device_id, 'windows-test');
assert.ok(plan.steps.length > 0);
assert.ok(plan.steps.every(step => step.executor_type === 'device'));
assert.ok(plan.steps.every(step => step.risk === 'low'));

console.log('DESKTOP_MISSION_RUNTIME_INTEGRATION_TEST=PASS');
