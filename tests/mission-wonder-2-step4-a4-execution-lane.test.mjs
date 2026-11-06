// Mission Wonder 2 — Step 4 A4: explicit execution-lane provenance contract.
//
// Proves, against source and migration text plus a faithful JS model of the guard's
// SQL predicate:
//   1. Every PWA A4 mission creation stamps execution_lane explicitly.
//   2. The standalone admission guard admits a mission whose metadata carries either
//      execution_lane OR goal_source — so the stalled 2026-11-05 A4 attempt cannot be
//      attributed to the lane guard (its intake already stamped goal_source="user").
//      This pins the corrected root-cause finding against mis-diagnosis regression:
//      if the guard ever drops the goal_source fallback, this contract fails loudly
//      and the inference must be revisited.
//   3. The stamped lane value keeps queue semantics identical to the effective lane
//      the mission already had (both resolve to "user").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(process.argv[1]), '..');
const sharedPath = path.join(root, 'supabase/functions/_shared/mission-wonder-2-a4-scope-v1.mjs');
const appApiPath = path.join(root, 'supabase/functions/aria-app-api-v3/index.ts');
const guardPath = path.join(root, 'supabase/migrations/20261101161000_aria_no_goal_mission_admission_lane_guard_v1.sql');
const shared = fs.readFileSync(sharedPath, 'utf8');
const appApi = fs.readFileSync(appApiPath, 'utf8');
const guard = fs.readFileSync(guardPath, 'utf8');

// 1. Shared constant is the single source of truth for the A4 lane value.
assert.match(shared, /export const A4_EXECUTION_LANE_V1 = "user";/);
assert.match(shared, /executionLane: "execution_lane"/);

// The PWA creation path for A4 missions must stamp the lane explicitly.
assert.ok(appApi.includes('import { A4_EXECUTION_LANE_V1,'), 'app-api must import the A4 lane constant');
assert.match(appApi, /mission_wonder_2_a4_readonly: true,\s*\n\s*execution_lane: A4_EXECUTION_LANE_V1,/);
// Behavior preservation: the same intake metadata still carries goal_source="user".
assert.match(appApi, /goal_source: "user",/);

// 2. Faithful model of the guard's standalone-lane clause (20261101161000 lines 37-43):
//    eligible when goal-linked, or when execution_lane/goal_source coalesce to text.
//    nullif/btrim are modeled loosely here on purpose: only blank-vs-nonblank matters.
const guardsModelStandaloneLane = (metadata) => {
  const lane = String(metadata.execution_lane ?? '').trim();
  const source = String(metadata.goal_source ?? '').trim();
  return lane !== '' || source !== '';
};

// The actual A4 attempt metadata (a4-report.json of run 42022813342, reconciled with
// the intake source): goal_source was stamped at creation => the guard did not block.
assert.equal(guardsModelStandaloneLane({ goal_source: 'user' }), true,
  'the stalled A4 mission WAS claim-eligible for the lane guard; the lane guard did not cause the stall');

// The guard still fail-closes truly blank standalone metadata (the failure class it exists for).
assert.equal(guardsModelStandaloneLane({}), false);
assert.equal(guardsModelStandaloneLane({ execution_lane: '', goal_source: '' }), false);

// Post-fix invariant: the explicit stamp occupies exactly the same bucket.
assert.equal(guardsModelStandaloneLane({ execution_lane: 'user' }), true);

// 3. Pin the guard's coalesce fallback in the deployed migration text. If this fallback
//    is ever removed, this contract fails and the lane-stamp inference must be re-proven.
assert.match(guard, /nullif\(m\.metadata->>'execution_lane',''\)/);
assert.match(guard, /nullif\(m\.metadata->>'goal_source',''\)/);
assert.match(guard, /g\.goal_id is not null/);

// Queue semantics: the coalesce pattern used across queue mechanics treats the lane the
// same way (execution_lane first, goal_source fallback) so the explicit "user" stamp
// cannot change the mission's queue bucket relative to the pre-fix effective lane.
const queueFiles = [
  'supabase/migrations/20261013223000_paused_pending_job_recovery_cap_v1.sql',
  'supabase/migrations/20261007173000_isolate_test_traffic_from_production_queue_v1.sql',
];
for (const rel of queueFiles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(text, /lower\(coalesce\(nullif\(m\.metadata->>'execution_lane',''\),\s*nullif\(m\.metadata->>'goal_source',''\),\s*''\)\)/,
    `queue mechanics must keep the execution_lane/goal_source coalesce: ${rel}`);
}

// The A4 lane constant literal: same value the mission previously derived via the
// goal_source fallback ("user"), so the explicit stamp is behavior-preserving by
// construction. (Dynamic import of the ESM module is asserted in the npm-move
// contract suite; here the pinned literal is the contract.)
assert.match(shared, /A4_EXECUTION_LANE_V1 = "user"/);
assert.match(appApi, /execution_lane: A4_EXECUTION_LANE_V1/);

console.log('mission-wonder-2-step4-a4-execution-lane contract: PASS');
