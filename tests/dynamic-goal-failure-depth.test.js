'use strict';

const assert = require('node:assert/strict');
const { generateCandidates } = require('../supabase/functions/aria-device-gateway/_shared/dynamic-goal-engine.mjs');

const firstLevel = generateCandidates({
  failures: [{ mission_id: 'mission-a', goal: 'A real failed mission', last_stderr: 'failure', metadata: {} }]
});
assert.equal(firstLevel.filter(c => c.source_type === 'failure').length, 1);
assert.equal(firstLevel.find(c => c.source_type === 'failure').metadata.derivation_depth, 1);

const secondLevel = generateCandidates({
  failures: [{ mission_id: 'mission-b', goal: 'Diagnose and resolve the verified failure from mission mission-a: failure', last_stderr: 'failure', metadata: { derivation_depth: 1 } }]
});
assert.equal(secondLevel.filter(c => c.source_type === 'failure').length, 0);

console.log('DYNAMIC_GOAL_FAILURE_DEPTH_GUARD_OK');
