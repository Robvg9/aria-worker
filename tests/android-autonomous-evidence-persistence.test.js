'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-device-gateway', 'index.ts'),
  'utf8'
);

assert.ok(gateway.includes('autonomousSummary='));
assert.ok(gateway.includes('baseMetadata.autonomous_test===true'));
assert.ok(gateway.includes('autonomous_summary:autonomousSummary'));
assert.ok(gateway.includes('autonomousInner.evidence.slice(0,64)'));
assert.ok(gateway.includes('autonomousInner.trace.slice(0,64)'));
assert.ok(gateway.includes('before_evidence_hash'));
assert.ok(gateway.includes('after_evidence_hash'));
assert.ok(!gateway.includes('autonomousInner.result'));
console.log('android-autonomous-evidence-persistence PASS');
