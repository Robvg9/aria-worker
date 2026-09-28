'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const classifier = require('../scripts/release-bearing');
const artifact = require('../scripts/delivery-artifact');
const gate = fs.readFileSync('.github/workflows/aria-delivery-deterministic-gate.yml', 'utf8');

assert.equal(classifier.classifyFiles(['README.md', 'docs/plan.md', 'tests/example.test.js']).release_bearing, false);
assert.equal(classifier.classifyFiles(['README.md', 'worker.js']).release_bearing, true);
assert.equal(typeof artifact.prepareReleaseArtifact, 'function');
assert.equal(typeof artifact.verifyLive, 'function');
assert.equal(artifact.sha256Text('a\r\nb'), artifact.sha256Text('a\nb'));
assert.equal(artifact.sha256Text('a\r\r\nb'), artifact.sha256Text('a\nb'));

assert.match(gate, /if: github\.event_name == 'pull_request'/);
assert.match(gate, /node tests\/delivery-deterministic-v1\.test\.js/);
assert.match(gate, /GITHUB_EVENT_PATH/);

console.log('DELIVERY DETERMINISM V1 CONTRACT: PASS');
