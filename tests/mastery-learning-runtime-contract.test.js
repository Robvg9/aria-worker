'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const planner = fs.readFileSync('supabase/functions/aria-planner-v11/index.ts','utf8');
const runner = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts','utf8');
const migration = fs.readFileSync('supabase/migrations/20260924_aria_learning_mastery_loop_v1.sql','utf8');

test('planner consults persistent mastery learning before route selection', () => {
  assert.match(planner, /aria_memory_learning_context_for_goal/);
  assert.match(planner, /learningContextForGoal\(goal\)/);
  assert.match(planner, /learned_knowledge/);
});

test('mission runner enforces learned preflight before execution', () => {
  assert.match(runner, /validate_learning_preflight/);
  assert.match(runner, /learning_preflight_blocked/);
  assert.match(runner, /applied_memory_ids/);
  assert.match(runner, /status: "replanned_learning"/);
  assert.match(runner, /verify_learning_application/);
  assert.match(runner, /learning_application_verified/);
});

test('production migration contains recurrence, candidate, promotion and regression gates', () => {
  assert.match(migration, /capture_failure_mastery/);
  assert.match(migration, /occurrence_count/);
  assert.match(migration, /root_cause_required/);
  assert.match(migration, /promote_failure_learning/);
  assert.match(migration, /verify_learning_application/);
  assert.match(migration, /verify_learning_application[\\s\\S]*as \\\$\\$/);
  assert.doesNotMatch(migration, /verify_learning_application[\\s\\S]*as \\\n\\s*declare/);
  assert.match(migration, /application_verified/);
  assert.match(migration, /Regression contract/);
  assert.match(migration, /deno\.json.*import_map|import_map.*deno\.json/s);
});

console.log('MASTERY LEARNING RUNTIME CONTRACT: PASS');
