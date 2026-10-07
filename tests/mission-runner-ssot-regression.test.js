const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const runner = fs.readFileSync("supabase/functions/aria-mission-runner-v22/index.ts", "utf8");
const appApi = fs.readFileSync("supabase/functions/aria-app-api-v3/index.ts", "utf8");
const pwaApp = fs.readFileSync("pwa/src/App.tsx", "utf8");

test("async device jobs are polled instead of re-enqueued", () => {
  assert.match(
    runner,
    /const pendingJobId = executorType\(step\) === "device"/,
    "runner must recognize a persisted pending device job before incrementing attempts"
  );
  assert.match(
    runner,
    /if \(pendingJobId\) \{[\s\S]{0,5000}getExecutionJob\(pendingJobId\)/,
    "runner must poll the canonical execution_jobs row"
  );
  assert.match(
    runner,
    /const nextAttempt = pendingAttempt > 0 \? pendingAttempt : Number\(attempts\[id\] \|\| 0\) \+ 1;/,
    "a resumed pending device job must preserve its original attempt number"
  );
  assert.match(
    runner,
    /paused -> retry -> re-enqueue loop/,
    "the regression guard must document the failure mode it prevents"
  );
});

test("PWA mission state uses the canonical mission_state source and live leases", () => {
  assert.match(
    appApi,
    /source_of_truth:"aria_internal\.mission_state"/,
    "meditation overview must expose the canonical mission source"
  );
  assert.match(
    appApi,
    /const activeRank=.*running.*hasLiveLease.*return 60.*if\(s==="waiting"&&hasLiveLease\(m\)\)return 45/s,
    "active mission ranking must require a live lease"
  );
  assert.doesNotMatch(
    appApi,
    /controller\?\.owner_user_id&&controller\.owner_user_id!==userId\)return\{owned:false,[\s\S]{0,500}missions:\[\]/,
    "a controller owned by another user must not fabricate an empty mission collection"
  );
});

test("PWA never promotes stale non-leased running/waiting missions to live execution", () => {
  assert.match(
    pwaApp,
    /if \(value === 'running' && leased\) return 60;\s*if \(value === 'waiting' && leased\) return 45;/,
    "leased running/waiting missions must remain the highest-priority live execution states"
  );
  assert.match(
    pwaApp,
    /const UNLEASED_RECOVERY_MAX_AGE_MS = 30 \* 60 \* 1000/,
    "PWA recovery must have a bounded freshness window"
  );
  assert.match(
    pwaApp,
    /const pendingJobs = mission\?\.checkpoint\?\.pending_jobs/,
    "PWA recovery must inspect persisted pending jobs"
  );
  assert.match(
    pwaApp,
    /age <= UNLEASED_RECOVERY_MAX_AGE_MS/,
    "PWA recovery must reject stale work"
  );
  assert.match(
    pwaApp,
    /activeMissionRank\(m\.status,m\.lease_owner,m\.lease_until,m\)/,
    "live mission selection must pass the complete mission object into the freshness guard"
  );
  assert.match(
    pwaApp,
    /const recoveryVisible=\(status==='running'\|\|status==='waiting'\) && !leaseValid && activeMissionRank\(status,mission\.lease_owner,mission\.lease_until,mission\)>=30/,
    "PWA live execution must use the same bounded recovery predicate as selection"
  );
  assert.doesNotMatch(
    pwaApp,
    /if \(value === 'running'\) return 35;\s*if \(value === 'waiting'\) return 30;/,
    "unleased missions must not be promoted indefinitely"
  );
});
