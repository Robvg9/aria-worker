'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8',
);

assert.match(source, /function githubArtifactProofRecoveryPlan\(goal:string, context:any\)/);
assert.match(source, /public\\\\\/aria-mission-proof\\\\\.html/);
assert.match(source, /recovery_route:"agent_to_github_connector"/);
assert.match(source, /operation:"create_branch"/);
assert.match(source, /operation:"file_write"/);
assert.match(source, /operation:"file_read"/);
assert.match(source, /non_main_branch_required:true/);
assert.match(source, /NO CONFIRMADO/);
assert.match(source, /agentStep\("verification_1"/);
console.log('MISSION PROOF GOVERNED CONNECTOR RECOVERY ROUTE: PASS');
