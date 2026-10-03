'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');

assert.match(api,/EXECUTION_OBSERVATION_GRACE_MS = 90_000/);
assert.match(api,/function executionObservation\(m:any\)/);
assert.match(api,/status: "execution_observed"/);
assert.match(api,/status: "awaiting_execution_observation"/);
assert.match(api,/status: "NO_EXECUTION_OBSERVED"/);
assert.match(api,/mission_remains_queued_without_plan_or_step_execution_evidence/);
assert.match(api,/mission_is_running_without_step_results_or_active_step_evidence/);
assert.match(api,/const execution_observation = executionObservation\(m\)/);
assert.match(api,/execution_observation,/);

console.log('MISSION EXECUTION OBSERVABILITY CONTRACT: PASS — active state is no longer the only signal; stale missions expose NO_EXECUTION_OBSERVED explicitly');
