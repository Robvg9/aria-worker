'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const extra = 'node tests/projects-rwht-mutation-gate.test.cjs';
const projectRunner = fs.readFileSync(path.join(root, 'rwht/pc-browser/rwht-projects-e2e.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/projects-rwht-authenticated.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(projectRunner, /const ALLOW_MUTATIONS = process\.env\.RWHT_ALLOW_MUTATIONS === 'true'/,
  'Projects RWHT must require an explicit true flag before mutating production');
assert.match(projectRunner, /const MUTATION_SKIP_REASON = String\(process\.env\.RWHT_MUTATION_SKIP_REASON/,
  'The mutation skip must retain a human-readable reason');
assert.match(projectRunner, /status: ALLOW_MUTATIONS \? 'ENABLED_FOR_EXPLICIT_TEST' : 'HUMAN_GATE'/,
  'Read-only runs must identify the visual-mission portion as a Human Gate');
assert.match(projectRunner, /const recoveredOrphans = ALLOW_MUTATIONS\s*\? await cleanupInterruptedRwhtVisualMissions/,
  'Orphan cleanup (which can cancel mission rows) must be disabled on read-only runs');

const gatePosition = projectRunner.indexOf('if (!ALLOW_MUTATIONS) {', projectRunner.indexOf('const afterDraw'));
const createClickPosition = projectRunner.indexOf('await visualMissionButton.click();');
assert.ok(gatePosition > 0 && createClickPosition > gatePosition,
  'The read-only Human Gate must execute before any visual mission submission');
const continuePosition = projectRunner.indexOf('continue;', gatePosition);
assert.ok(continuePosition > gatePosition && continuePosition < createClickPosition,
  'The read-only branch must skip all canonical mission creation and read-back code');
assert.match(projectRunner, /report\.visual_canvas_checks\.push/,
  'ARTIA drawing interactions should still be certified without a server mission');
assert.match(projectRunner, /mutation_attempted: false/,
  'The default run must persist evidence that no mutation was attempted');
assert.match(projectRunner, /report\.visual_mission_gate\.status = 'HUMAN_GATE'/,
  'The ordinary visual mission E2E must remain explicitly open');
assert.match(projectRunner, /status: report\.verified \? \(report\.visual_mission_gate\?\.status === 'HUMAN_GATE' \? 'verified_read_only' : 'verified'\) : 'failed'/,
  'A read-only project suite must not be reported as a full mission E2E pass');
assert.match(projectRunner, /visual_mission_gate: report\.visual_mission_gate\?\.status/,
  'The terminal log must surface the mission Human Gate separately');

assert.match(workflow, /RWHT_ALLOW_MUTATIONS: 'false'/,
  'The main Projects certification must stay read-only');
assert.match(workflow, /RWHT_MUTATION_SKIP_REASON: 'MISSION_EXECUTION_PAUSED=true/,
  'The workflow must explain that the mission gate is held by the global freeze');
assert.match(workflow, /PASS \(READ-ONLY\)/,
  'The issue report must label the non-mutating UI result explicitly');
assert.match(workflow, /POST de misión intentado/,
  'Evidence must explicitly state whether a mission POST was attempted');
assert.match(workflow, /OPEN — requiere objetivo real y autorización explícita/,
  'Read-only UI certification must not close the ordinary A4 mission gate');
assert.ok(pkg.scripts.test.includes(extra),
  'The Projects mission-mutation contract must be part of the standard npm test suite');

console.log('PROJECTS RWHT MUTATION/FREEZE CONTRACT: PASS');
