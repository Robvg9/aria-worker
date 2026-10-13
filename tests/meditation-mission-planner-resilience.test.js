'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const planner = fs.readFileSync(path.join(root, 'supabase/functions/aria-planner-v11/index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');

const reviewStart = planner.indexOf('async function projectReviewPlan');
const reviewEnd = planner.indexOf('async function allForOnePlan', reviewStart);
assert.ok(reviewStart >= 0 && reviewEnd > reviewStart, 'project review planner function must exist');
const projectReview = planner.slice(reviewStart, reviewEnd);
assert.ok(projectReview.includes('const routes=await modelRoutes()'), 'project review must use currently registered model routes');
assert.ok(projectReview.includes('modelStep("facts_1"'), 'facts phase must execute through a model route');
assert.ok(projectReview.includes('modelStep("crosscheck_1"'), 'cross-check phase must execute through a model route');
assert.ok(projectReview.includes('modelStep("summary_1"'), 'summary phase must execute through a model route');
assert.ok(!projectReview.includes('agentStep("facts_1"'), 'facts must not depend on the same generic reviewer agent');
assert.ok(projectReview.includes('aria-planner-v11-live-project-review-v3-multi-model'), 'new multi-model planner version must be traceable');

assert.ok(runner.includes('function isReadOnlyPlanRecoveryAllowed(goal: string)'), 'empty-plan fallback must enforce read-only eligibility');
assert.ok(runner.includes('async function buildReadOnlyPlanFallback'), 'deterministic read-only fallback must exist');
assert.ok(runner.includes('planner_empty_steps_detected'), 'empty plans must leave persisted diagnostics');
assert.ok(runner.includes('planner_empty_readonly_fallback_selected'), 'selected fallback strategy must be recorded');
assert.ok(runner.includes('write_tasks_never_model_only: true'), 'write/deploy goals must never fall back to model-only success');
assert.ok(runner.includes('planner_empty_steps'), 'non-recoverable empty plans must remain truthfully blocked');
console.log('Meditation IA planner and empty-plan recovery contract: PASS');
