'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pwaWorkflow = fs.readFileSync(path.join(root, '.github/workflows/aria-pwa-fast-deploy.yml'), 'utf8');
const workerWorkflow = fs.readFileSync(path.join(root, '.github/workflows/aria-cloudflare-deploy.yml'), 'utf8');

const sharedReleasePaths = [
  'rwht/pc-browser/rwht-responsive-ux-e2e.mjs',
  'tests/pwa-responsive-ux-v1.test.js',
  'rwht/pc-browser/rwht-persistence-recovery-e2e.mjs',
  'tests/pwa-persistence-recovery-v1.test.js'
];

for (const releasePath of sharedReleasePaths) {
  assert.ok(pwaWorkflow.includes(releasePath), `PWA deploy must trigger on ${releasePath}`);
  assert.ok(workerWorkflow.includes(releasePath), `Worker deploy must trigger on ${releasePath}`);
}

assert.ok(
  pwaWorkflow.includes('.github/workflows/aria-cloudflare-deploy.yml'),
  'PWA deploy must trigger when the paired Worker deploy workflow changes'
);
assert.ok(
  workerWorkflow.includes('.github/workflows/aria-pwa-fast-deploy.yml'),
  'Worker deploy must trigger when the paired PWA deploy workflow changes'
);

console.log('EXACT-SHA DEPLOY TRIGGER CONTRACT: PASS');
