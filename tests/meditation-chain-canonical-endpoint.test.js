'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(
  'supabase/functions/aria-mission-runner-v22/index.ts',
  'utf8'
);

assert.match(source, /const CANONICAL = .*aria-canonical-runtime-v1/);
assert.match(source, /fetch\(CANONICAL/);
assert.match(source, /x-aria-trigger.*meditation-ia/);
assert.match(source, /chainNextMeditationMission\(chainDepth\)/);
assert.doesNotMatch(source, /chainNextMeditationMission\(request\.url/);

console.log('MEDITATION CHAIN CANONICAL ENDPOINT: PASS');
