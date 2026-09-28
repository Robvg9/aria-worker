'use strict';

const assert = require('node:assert/strict');
const classifier = require('../scripts/release-bearing');
const artifact = require('../scripts/delivery-artifact');

assert.equal(classifier.classifyFiles(['README.md', 'docs/plan.md', 'tests/example.test.js']).release_bearing, false);
assert.equal(classifier.classifyFiles(['README.md', 'worker.js']).release_bearing, true);
assert.equal(typeof artifact.prepareReleaseArtifact, 'function');
assert.equal(typeof artifact.verifyLive, 'function');

console.log('DELIVERY DETERMINISM V1 CONTRACT: PASS');
