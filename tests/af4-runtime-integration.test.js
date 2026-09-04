'use strict';

const assert = require('assert');
const { createAriaRuntime } = require('../activation/bootstrap');

const runtime = createAriaRuntime();

assert.ok(runtime.autonomy);
assert.ok(runtime.autonomy.coordinator);
assert.ok(runtime.autonomy.missionOrchestrator);
assert.strictEqual(typeof runtime.autonomy.missionOrchestrator.createAutonomousMissionOrchestrator, 'function');
assert.ok(runtime.execution.missionState);
assert.strictEqual(typeof runtime.execution.missionState.createMissionStateStore, 'function');

console.log('AF-4 runtime integration test passed');
