'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8',
);

for (const marker of [
  'function githubArtifactProofRecoveryPlan(goal:string, context:any)',
  'artifact_path:"public/aria-mission-proof.html"',
  'recovery_route:"agent_to_github_connector"',
  'operation:"create_branch"',
  'operation:"file_write"',
  'operation:"file_read"',
  'non_main_branch_required:true',
  'NO CONFIRMADO',
  'agentStep("verification_1"',
]) {
  assert.ok(source.includes(marker), `missing planner marker: ${marker}`);
}

console.log('MISSION PROOF GOVERNED CONNECTOR RECOVERY ROUTE: PASS');
