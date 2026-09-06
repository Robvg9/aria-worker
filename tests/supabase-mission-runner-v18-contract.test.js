'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v18/index.ts'), 'utf8');
const canonical = fs.readFileSync(path.join(root, 'supabase/functions/aria-canonical-runtime-v1/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260906041000_block3_universal_observability_events.sql'), 'utf8');

assert.ok(runner.includes('aria_mission_claim_by_id_lease'), 'v18 must use atomic claim-by-id lease');
assert.ok(runner.includes('deviceExecute'), 'v18 must retain device executor');
assert.ok(runner.includes('enqueue_execution_job_gateway'), 'v18 must dispatch device jobs through governed gateway');
assert.ok(runner.includes('parallelSafe'), 'v18 must retain governed parallel batching');
assert.ok(runner.includes('Promise.all'), 'v18 must execute safe ready batches concurrently');
assert.ok(runner.includes('step_batch_started'), 'v18 must emit supported batch observability');
assert.ok(runner.includes('cognitive-loop-v2'), 'v18 must preserve cognitive recall contract');
assert.ok(runner.includes('verifyStrategicCompletion'), 'v18 must preserve strategic completion guard');
assert.ok(canonical.includes('aria-mission-runner-v18'), 'canonical runtime must target v18');
assert.ok(migration.includes("'step_batch_started'"), 'DB event contract must allow batch event');

console.log('SUPABASE MISSION RUNNER V18 CONTRACT: PASS — atomic claim, device gateway, governed batching, cognition, strategic guard, canonical wiring, DB event contract');
