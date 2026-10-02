'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20261002000000_strategy_failure_memory_v1.sql',
  'utf8'
);
const runner = fs.readFileSync(
  'supabase/functions/aria-mission-runner-v22/index.ts',
  'utf8'
);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.strategy_failure_ledger/);
assert.match(migration, /same_strategy_replan_threshold/);
assert.match(migration, /same_strategy_hard_block_threshold/);
assert.match(migration, /CREATE OR REPLACE FUNCTION aria_internal\.record_strategy_failure/);
assert.match(migration, /failure_count/);
assert.match(migration, /blocked/);
assert.match(migration, /hard_block/);

const signatureStart = runner.indexOf('function planStrategySignature(steps:any[])');
const signatureEnd = runner.indexOf('function normalizeGoalForFailureMemory', signatureStart);
assert.ok(signatureStart >= 0 && signatureEnd > signatureStart);
const signature = runner.slice(signatureStart, signatureEnd);
assert.doesNotMatch(signature, /id:\s*String\(step\?\.id/);
assert.match(signature, /executor_type/);
assert.match(signature, /operation/);
assert.match(signature, /target/);

assert.match(runner, /async function goalFailureSignature/);
assert.match(runner, /strategy_failure_ledger/);
assert.match(runner, /mission_alternative_strategy_needed/);
assert.match(runner, /mission_replanned/);
assert.match(runner, /recovery_attempted/);
assert.match(runner, /recordFailureMemory/);
assert.match(runner, /aria_internal\.record_strategy_failure/);

console.log('STRATEGY FAILURE MEMORY V1: PASS');
