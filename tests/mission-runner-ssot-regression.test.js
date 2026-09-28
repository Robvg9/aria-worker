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

test("PWA never treats a non-leased running/waiting mission as live", () => {
  assert.match(
    pwaApp,
    /if \(value === 'running' && leased\) return 60;\s*if \(value === 'waiting' && leased\) return 45;\s*\/\/ Sin lease vigente,/,
    "PWA active mission selection must require a live lease for running/waiting states"
  );
  assert.doesNotMatch(
    pwaApp,
    /if \(value === 'running'\) return 50;|if \(value === 'waiting'\) return 40;/,
    "PWA must not promote non-leased mission states into live execution"
  );
});
