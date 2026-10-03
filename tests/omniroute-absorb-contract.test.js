'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'absorb/omniroute/SOURCE_LOCK.json'), 'utf8'));
const contract = fs.readFileSync(path.join(root, 'absorb/omniroute/INTEGRATION_CONTRACT.md'), 'utf8');

let passed = 0;
function testCase(name, fn) {
  fn();
  passed += 1;
  console.log('PASS ' + name);
}

testCase('source repository is pinned', () => {
  assert.strictEqual(lock.source.repository, 'diegosouzapw/OmniRoute');
});

testCase('release ref is explicit', () => {
  assert.strictEqual(lock.source.ref, 'release/v3.8.52');
});

testCase('commit lock is a full SHA', () => {
  assert.match(lock.source.commit_sha, /^[0-9a-f]{40}$/);
});

testCase('runtime is disabled before sandbox gates', () => {
  assert.strictEqual(lock.runtime_enabled, false);
  assert.strictEqual(lock.execution_policy.external_code_execution, false);
  assert.strictEqual(lock.execution_policy.downloaded_code_execution, false);
});

testCase('artifact digest is never fabricated while sandbox is blocked', () => {
  assert.strictEqual(lock.artifact_digest.sha256, null);
  assert.strictEqual(lock.artifact_digest.status, 'PENDING_SANDBOX_CAPTURE');
});

testCase('phase ordering is preserved', () => {
  const expected = 'Source Lock → Audit → Sandbox → Standalone → Provider → Adapter → Router → Resilience → Recovery → Security → E2E → Negative → Evaluation → Registration';
  assert.ok(contract.includes(expected));
});

testCase('ARIA authority is explicitly preserved', () => {
  for (const token of [
    'permissions and Human Gate',
    'mission lifecycle',
    'canonical persistence',
    'learning and lifecycle decisions'
  ]) {
    assert.ok(contract.includes(token), token);
  }
});

testCase('duplicate control planes are prohibited', () => {
  for (const token of [
    'replace ARIA Router v2',
    'replace Capability Registry',
    'replace Permissions/Human Gate',
    'replace Mission Runtime',
    'create a second Verification/Evidence/Memory subsystem'
  ]) {
    assert.ok(contract.includes(token), token);
  }
});

testCase('loopback endpoint is configuration-only until real health evidence exists', () => {
  assert.ok(contract.includes('http://127.0.0.1:20128/v1'));
  assert.ok(contract.includes('Availability is proven exclusively by a real health probe'));
});

testCase('runtime adapter gate remains closed before phases 3-5', () => {
  assert.ok(contract.includes('Phase 6+ runtime implementation is prohibited until'));
  assert.ok(contract.includes('Phase 3 isolated installation is PASS'));
  assert.ok(contract.includes('Phase 4 standalone smoke is PASS'));
  assert.ok(contract.includes('Phase 5 OmniRoute → Ollama → Qwen is LIVE PASS'));
});

console.log('\nOmniRoute ABSORB Phase 1-2 gate: ' + passed + ' passed, 0 failed');
