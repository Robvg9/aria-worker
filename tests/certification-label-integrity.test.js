'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflows = [
  '.github/workflows/continuous-self-improvement-v1-live.yml',
  '.github/workflows/device-universe-v1-live.yml',
  '.github/workflows/multi-agent-v2-live.yml',
  '.github/workflows/resource-intelligence-v1-live.yml',
  '.github/workflows/meta-reasoning-v1-live.yml',
  '.github/workflows/world-model-v2-live.yml',
  '.github/workflows/verify-self-model-v2-live.yml',
  '.github/workflows/evaluation-engine-v2-live.yml',
  '.github/workflows/security-v2-live.yml'
];

for (const file of workflows) {
  const text = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  assert.match(text, /^name:.*CONTRACT/m, `${file}: must be classified as CONTRACT`);
  assert.doesNotMatch(text, /LIVE certification/, `${file}: must not claim LIVE certification`);
  assert.doesNotMatch(text, /_LIVE_OK/, `${file}: must not emit LIVE marker`);
}

console.log('CERTIFICATION LABEL INTEGRITY: PASS — synthetic checks cannot be labeled LIVE');
