'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runnerPath = path.resolve(__dirname, '../supabase/functions/aria-mission-runner-v22/index.ts');
const source = fs.readFileSync(runnerPath, 'utf8');

const checkpointStart = source.indexOf('      const checkpoint = {');
assert.ok(checkpointStart >= 0, 'checkpoint construction missing');

const checkpointEnd = source.indexOf('      if (waiting) {', checkpointStart);
assert.ok(checkpointEnd > checkpointStart, 'checkpoint boundary missing');

const checkpointBlock = source.slice(checkpointStart, checkpointEnd);
assert.match(
  checkpointBlock,
  /mission\.checkpoint\s*=\s*checkpoint;/,
  'in-memory mission checkpoint must be refreshed before the next batch'
);

const syncIndex = checkpointBlock.indexOf('mission.checkpoint = checkpoint;');
assert.ok(syncIndex > 0, 'checkpoint refresh must occur after checkpoint construction');

console.log('HUMAN_GATE_SAME_TICK_CHECKPOINT_REGRESSION: PASS');
