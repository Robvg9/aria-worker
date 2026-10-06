'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8'
);

assert.match(source, /missionProofGovernedRecoveryPlan/);
assert.match(source, /aria-mission-proof\\.html/);
assert.match(source, /id:"implementation_create_branch"/);
assert.match(source, /operation:"create_branch"/);
assert.match(source, /id:"implementation_write_artifact"/);
assert.match(source, /operation:"file_write"/);
assert.match(source, /id:"implementation_verify_artifact"/);
assert.match(source, /operation:"file_read"/);
assert.match(source, /aria-agent-reviewer-v1/);
assert.match(source, /recovery_route:"governed_github_connector"/);

console.log('MISSION PROOF GOVERNED GITHUB RECOVERY PLAN: PASS');
