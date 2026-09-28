'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const classifier = require('../scripts/release-bearing');
const artifact = require('../scripts/delivery-artifact');
const gate = fs.readFileSync('.github/workflows/aria-delivery-deterministic-gate.yml', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml', 'utf8');

assert.equal(classifier.classifyFiles(['README.md', 'docs/plan.md', 'tests/example.test.js']).release_bearing, false);
assert.equal(classifier.classifyFiles(['README.md', 'worker.js']).release_bearing, true);
assert.equal(classifier.classifyFiles(['.github/workflows/aria-delivery-deterministic-gate.yml']).release_bearing, false);
assert.equal(typeof artifact.prepareReleaseArtifact, 'function');
assert.equal(typeof artifact.verifyLive, 'function');
assert.equal(typeof artifact.verifyLiveOnce, 'function');
assert.match(artifact.verifyLive.toString(), /LIVE_STABILIZATION_TIMEOUT/);
assert.equal(typeof artifact.buildRuntimeServiceWorker, 'function');
assert.equal(typeof artifact.fetchText, 'function');
assert.match(artifact.fetchText.toString(), /attempts = 3/);
assert.equal(artifact.sha256Text('a\r\nb'), artifact.sha256Text('a\nb'));
assert.equal(artifact.sha256Text('a\r\r\nb'), artifact.sha256Text('a\nb'));

assert.match(gate, /if: github\.event_name == 'pull_request'/);
assert.match(gate, /node tests\/delivery-deterministic-v1\.test\.js/);
assert.match(gate, /GITHUB_EVENT_PATH/);
assert.match(gate, /push:/);
assert.match(gate, /github.event_name == 'push'/);
assert.match(gate, /Wait for exact SHA to appear LIVE/);
assert.match(gate, /include-hidden-files: true/);
assert.match(deployWorkflow, /--secrets-file \.cloudflare-runtime-secrets\.json/);
const recoveryWorkflow = deployWorkflow;
assert.match(recoveryWorkflow, /for attempt in \$\(seq 1 30\); do/);
assert.match(recoveryWorkflow, /index-stale-test\.html\?probe=/);
assert.match(recoveryWorkflow, /sw-stale-test\.js\?probe=/);
assert.doesNotMatch(deployWorkflow, /wrangler secret put CLOUDFLARE_API_TOKEN/);
assert.equal(artifact.buildRuntimeServiceWorker("const CACHE = 'aria-pwa-__BUILD__';\r\nself.x=1;", 'abc').split('\n')[0], 'const CACHE = "aria-pwa-abc";');

console.log('DELIVERY DETERMINISM V1 CONTRACT: PASS');
