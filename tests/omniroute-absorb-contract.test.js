'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'absorb/omniroute/SOURCE_LOCK.json'), 'utf8'));
const contract = fs.readFileSync(path.join(root, 'absorb/omniroute/INTEGRATION_CONTRACT.md'), 'utf8');
const phase3Contract = fs.readFileSync(path.join(root, 'absorb/omniroute/PHASE_3_SANDBOX_CONTRACT.md'), 'utf8');
const phase3Script = fs.readFileSync(path.join(root, 'scripts/absorb/omniroute-phase3-sandbox.ps1'), 'utf8');
const phase4Contract = fs.readFileSync(path.join(root, 'absorb/omniroute/PHASE_4_STANDALONE_CONTRACT.md'), 'utf8');
const phase4Runner = fs.readFileSync(path.join(root, 'scripts/absorb/omniroute-phase4-standalone-smoke.mjs'), 'utf8');

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

testCase('phase 3 blocker reflects the current environment', () => {
  assert.strictEqual(lock.gates.phase_3_sandbox, 'BLOCKED_ENVIRONMENT_NETWORK');
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

testCase('phase 3 sandbox contract is prepared and fail-closed', () => {
  assert.ok(phase3Contract.includes('Status: PREPARED / NOT CERTIFIED'));
  assert.ok(phase3Contract.includes('OmniRoute-v3.8.52'));
  assert.ok(phase3Contract.includes('HOST=127.0.0.1'));
  assert.ok(phase3Contract.includes('npm ci'));
  assert.ok(phase3Contract.includes('GET /api/health'));
  assert.ok(phase3Contract.includes('Phase 3 — SANDBOX = BLOCKED / NOT CERTIFIED.'));
});

testCase('phase 4 standalone contract stays after phase 3', () => {
  assert.ok(phase4Contract.includes('Status: PREPARED / NOT CERTIFIED'));
  assert.ok(phase4Contract.includes('/api/health'));
  assert.ok(phase4Contract.includes('/api/health/ping'));
  assert.ok(phase4Contract.includes('/v1/models'));
  assert.ok(phase4Contract.includes('Non-streaming chat completion'));
  assert.ok(phase4Contract.includes('Streaming chat completion'));
  assert.ok(phase4Contract.includes('restart/persistence'));
  assert.ok(phase4Contract.includes('Phase 4 — STANDALONE SMOKE = PREPARED / NOT CERTIFIED.'));
});

testCase('phase 4 runner is fail-closed and never certifies missing prerequisites', () => {
  assert.ok(phase4Runner.includes("OMNIROUTE_API_KEY"));
  assert.ok(phase4Runner.includes("OMNIROUTE_SMOKE_MODEL"));
  assert.ok(phase4Runner.includes("'NOT_CERTIFIED'"));
  assert.ok(phase4Runner.includes("'/v1/models'"));
  assert.ok(phase4Runner.includes("'/v1/chat/completions'"));
  assert.ok(phase4Runner.includes("'[DONE]'"));
});

testCase('phase 3 runner is locked to the exact source and isolated resources', () => {
  assert.ok(phase3Script.includes("release/v3.8.52"));
  assert.ok(phase3Script.includes("3e66ff2e8cc94821b093fe57dad667b585230cd1"));
  assert.ok(phase3Script.includes('archive/$Commit.zip'));
  assert.ok(phase3Script.includes("$env:HOST = '127.0.0.1'"));
  assert.ok(phase3Script.includes("$env:PORT = '20128'"));
  assert.ok(phase3Script.includes('$env:DATA_DIR = $DataDir'));
  assert.ok(phase3Script.includes('$env:NPM_CONFIG_CACHE = $CacheDir'));
  assert.ok(phase3Script.includes('taskkill.exe /PID $Server.Id /T /F'));
  assert.ok(phase3Script.includes('PHASE3_SANDBOX_EXECUTION=PASS'));
});

testCase('runtime adapter gate remains closed before phases 3-5', () => {
  assert.ok(contract.includes('Phase 6+ runtime implementation is prohibited until'));
  assert.ok(contract.includes('Phase 3 isolated installation is PASS'));
  assert.ok(contract.includes('Phase 4 standalone smoke is PASS'));
  assert.ok(contract.includes('Phase 5 OmniRoute → Ollama → Qwen is LIVE PASS'));
});

console.log('\nOmniRoute ABSORB Phase 1-4 contract: ' + passed + ' passed, 0 failed');
