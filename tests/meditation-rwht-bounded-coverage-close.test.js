'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'agents', 'windows', 'autonomous-rwht-controller.js'),
  'utf8'
);

assert.match(source, /const exitCoverageComplete =/);
assert.match(source, /exitCoverageVerifiedActions > 0/);
assert.match(source, /exercisedControls\.size \+ blockedControls\.size >= discoveredControls\.size/);
assert.match(source, /finishReason === 'bounded_run_exhausted' && exitCoverageComplete/);
assert.match(source, /finishReason = 'coverage_complete'/);

console.log('MEDITATION RWHT BOUNDED-COVERAGE CLOSE CONTRACT: PASS');
