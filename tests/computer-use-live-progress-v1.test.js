'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const migration = read('supabase/migrations/20260924180000_computer_use_live_progress_v1.sql');
const controller = read('agents/windows/autonomous-rwht-controller.js');
const agent = read('agents/windows/aria-agent.js');
const gateway = read('supabase/functions/aria-device-gateway/index.ts');
const runner = read('supabase/functions/aria-mission-runner-v22/index.ts');
const app = read('pwa/src/App.tsx');

for (const type of [
  'computer_use_capabilities_confirmed',
  'computer_use_device_confirmed',
  'computer_use_observation_started',
  'computer_use_observation_completed',
  'computer_use_decision_made',
  'computer_use_action_started',
  'computer_use_action_executed',
  'computer_use_result_observed',
  'computer_use_verification_completed',
  'computer_use_action_blocked'
]) {
  assert.match(migration, new RegExp(type), 'migration missing event type: ' + type);
  assert.match(controller, new RegExp(type), 'controller missing event type: ' + type);
  assert.match(gateway, new RegExp(type), 'gateway missing event type: ' + type);
}

assert.match(agent, /\/v1\/jobs\/\$\{encodeURIComponent\(job\.job_id\)\}\/progress/);
assert.match(gateway, /\/v1\/jobs\/\(\[\^\/\]\+\)\/progress/);
assert.match(gateway, /from\('mission_events'\)/);
assert.match(gateway, /from\('execution_job_events'\)/);

assert.match(runner, /function objectivePlanAlignment/);
assert.match(runner, /diagnostic_surface_mismatch/);
assert.match(runner, /rwht_capability_mismatch/);
assert.match(runner, /objective_plan_guard/);
assert.match(runner, /replanned_objective_alignment/);

assert.match(app, /humanizeStructuredMissionResult/);
assert.match(app, /missionObjectivePresentation/);
assert.match(app, /Objetivo no demostrado/);
assert.match(app, /computer_use_decision_made/);
assert.match(app, /computer_use_verification_completed/);
assert.match(app, /PLAN DE TRABAJO/);
assert.doesNotMatch(app, /Cancelar ejecución/);

console.log('COMPUTER USE LIVE PROGRESS V1: PASS');
