const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const runner = fs.readFileSync("supabase/functions/aria-mission-runner-v22/index.ts", "utf8");
const appApi = fs.readFileSync("supabase/functions/aria-app-api-v3/index.ts", "utf8");
const pwaApp = fs.readFileSync("pwa/src/App.tsx", "utf8");

test("async device and local-model jobs are reconciled instead of re-enqueued", () => {
  assert.match(runner, /const pendingJobId = typeof pending\?\.job_id === "string"/, "runner must recognize a persisted pending job regardless of planner executor type");
  assert.match(runner, /if \(pendingJobId\) \{[\s\S]{0,7000}getExecutionJob\(pendingJobId\)/, "runner must poll the canonical execution_jobs row");
  assert.match(runner, /let reconciledPendingResult: any = null;/, "runner must materialize a terminal persisted job into a mission result");
  assert.match(runner, /if \(!reconciledPendingResult\) \{[\s\S]{0,8000}result = await executeStep/, "terminal pending jobs must be reconciled before fresh execution");
  assert.match(runner, /if \(localResult\?\.status === "waiting"\) \{[\s\S]{0,1800}pending_source: "windows_ollama"/, "local Windows/Qwen async jobs must remain durable pending work");
  assert.match(runner, /pending_reconciled: true/, "successful local job reconciliation must be explicitly evidenced");
  assert.match(runner, /const nextAttempt = pendingAttempt > 0 \? pendingAttempt : Number\(attempts\[id\] \|\| 0\) \+ 1;/, "a resumed pending job must preserve its original attempt number");
  assert.match(runner, /paused -> retry -> re-enqueue loop/, "the regression guard must document the failure mode it prevents");
});

test("PWA mission state uses the canonical mission_state source and live leases", () => {
  assert.match(appApi, /source_of_truth:"aria_internal\.mission_state"/, "meditation overview must expose the canonical mission source");
  assert.match(appApi, /const activeRank=.*running.*hasLiveLease.*return 60.*if\(s==="waiting"&&hasLiveLease\(m\)\)return 45/s, "active mission ranking must require a live lease");
  assert.doesNotMatch(appApi, /controller\?\.owner_user_id&&controller\.owner_user_id!==userId\)return\{owned:false,[\s\S]{0,500}missions:\[\]/, "a controller owned by another user must not fabricate an empty mission collection");
});

test("PWA never treats a non-leased running/waiting mission as live", () => {
  assert.match(pwaApp, /if \(value === 'running' && leased\) return 60;\s*if \(value === 'waiting' && leased\) return 45;\s*\/\/ Sin lease vigente,/, "PWA active mission selection must require a live lease");
  assert.doesNotMatch(pwaApp, /if \(value === 'running'\) return 50;|if \(value === 'waiting'\) return 40;/, "PWA must not promote non-leased mission states into live execution");
});
