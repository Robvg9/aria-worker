'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const CAPABILITIES = Object.freeze([
  { id: 'memory', modules: ['supabase/functions/aria-memory-v2'], tests: ['tests/memory-v2-contract.test.js'] },
  { id: 'cognitive_loop', modules: ['autonomy/cognitive-loop.js'], tests: ['tests/cognitive-loop-v2.test.js'] },
  { id: 'dynamic_goals', modules: ['autonomy/dynamic-goal-engine.mjs'], tests: ['tests/dynamic-goal-engine.test.js'] },
  { id: 'planner', modules: ['planning/advanced-planner.js', 'autonomy/advanced-planner-runtime.js'], tests: ['tests/advanced-planner-v1.test.js', 'tests/advanced-planner-runtime.test.js', 'tests/advanced-planner-orchestrator.test.js'] },
  { id: 'router', modules: ['router/lookup.js'], tests: ['tests/intelligent-router-current.test.js'] },
  { id: 'execution', modules: ['execution/lookup.js'], tests: ['tests/execution.test.js', 'tests/universal-executor.test.js'] },
  { id: 'mission_runtime', modules: ['supabase/functions/aria-mission-runner-v22'], tests: ['tests/mission-state.test.js', 'tests/universal-mission.test.js'] },
  { id: 'smart_verifier', modules: ['verification/smart-verifier.js'], tests: ['tests/smart-verifier.test.js'] },
  { id: 'learning', modules: ['learning/engine.js'], tests: ['tests/skills-learning-v2.test.js', 'tests/failure-prevention-learning-v1.test.js'] },
  { id: 'self_model', modules: ['self-model/self-model-v2.js', 'self-model/capability-graph-v2.js'], tests: ['tests/self-model-v2.test.js'] },
  { id: 'self_development', modules: ['self-development/self-development-v2.js'], tests: ['tests/self-development-v2.test.js', 'tests/self-development-github-lifecycle.test.js', 'tests/self-development-evaluation-ledger.test.js'] },
  { id: 'continuous_self_improvement', modules: ['autonomy/continuous-self-improvement-v1.js'], tests: ['tests/continuous-self-improvement-v1.test.js'] },
  { id: 'evaluation', modules: ['evaluation/engine-v2.js'], tests: ['tests/evaluation-engine-v2.test.js', 'tests/evaluation-self-model-v2.integration.test.js', 'tests/evaluation-contract-v2.test.js'] },
  { id: 'computer_use', modules: ['computer-use/runtime-v1.js'], tests: ['tests/computer-use-runtime-v1.test.js'] },
  { id: 'multi_agent', modules: ['agents/manager-v2.js'], tests: ['tests/multi-agent-v2.test.js', 'tests/multi-agent-runtime-v2.test.js'] },
  { id: 'android_runtime', modules: ['devices/registry.js', 'devices/runtime-v1.js'], tests: ['tests/device-universe-v1.test.js', 'tests/live-device-client.test.js'] },
  { id: 'canonical_runtime', modules: ['supabase/functions/aria-canonical-runtime-v1'], tests: ['tests/canonical-runtime.test.js'] }
]);

function exists(relativePath) { return fs.existsSync(path.join(ROOT, relativePath)); }
function packageText() { return fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'); }
function runTest(relativePath) {
  const result = spawnSync(process.execPath, [path.join(ROOT, relativePath)], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: process.env });
  return { status: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '' };
}

for (const capability of CAPABILITIES) {
  assert.ok(capability.modules.every(exists), `${capability.id}: module wiring missing`);
  assert.ok(capability.tests.every(exists), `${capability.id}: dedicated test missing`);
  assert.ok(capability.tests.every(testPath => packageText().includes(`node ${testPath}`)), `${capability.id}: test is not in canonical npm test pipeline`);
}

const deterministicChecks = [
  'tests/cognitive-loop-v2.test.js',
  'tests/dynamic-goal-engine.test.js',
  'tests/advanced-planner-v1.test.js',
  'tests/smart-verifier.test.js',
  'tests/skills-learning-v2.test.js',
  'tests/failure-prevention-learning-v1.test.js',
  'tests/self-model-v2.test.js',
  'tests/self-development-v2.test.js',
  'tests/continuous-self-improvement-v1.test.js',
  'tests/evaluation-engine-v2.test.js'
];

for (const testPath of deterministicChecks) {
  const result = runTest(testPath);
  assert.equal(result.status, 0, `${testPath} failed:\n${result.stdout}\n${result.stderr}`);
}

console.log(`CAPABILITY AUDIT V1: PASS — ${CAPABILITIES.length} capabilities wired, canonicalized and backed by executable deterministic tests`);
