'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8',
);

assert.match(source, /async function missionProofArtifactPlan/);
assert.match(source, /recovery_route:"github_connector_artifact_write"/);
assert.match(source, /operation:"create_branch"/);
assert.match(source, /operation:"file_write"/);
assert.match(source, /operation:"file_read"/);
assert.match(source, /public\/aria-mission-proof\.html/);
assert.match(source, /source_ref/);
assert.match(source, /captured_at_utc/);
assert.match(source, /NO CONFIRMADO/);
console.log('MISSION PROOF GOVERNED CONNECTOR RECOVERY CONTRACT: PASS');
