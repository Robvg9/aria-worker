'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contract = fs.readFileSync(path.join(root, 'absorb/omniroute/PHASE_5_PROVIDER_CONTRACT.md'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/absorb/omniroute-phase5-ollama-qwen.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/omniroute-phase5-hosted-real.yml'), 'utf8');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'absorb/omniroute/PHASE_5_HOSTED_EVIDENCE.json'), 'utf8'));

for (const token of [
  'Status: HOSTED_REAL_PASS / PHYSICAL_SELF_HOSTED_PENDING',
  'Ollama',
  'qwen3:4b',
  'OMNIROUTE_QWEN_LIVE_OK',
  '20130',
  '3e66ff2e8cc94821b093fe57dad667b585230cd1',
  'HTTP 200'
]) assert.ok(contract.includes(token), token);

for (const token of [
  '/v1/chat/completions',
  'x-omniroute-routed-by',
  'x-omniroute-route-decision',
  'ollama/qwen3:4b',
  'OMNIROUTE_QWEN_LIVE_OK',
  'PASS_REAL_OLLAMA_QWEN'
]) assert.ok(smoke.includes(token), token);

for (const token of [
  'runs-on: windows-latest',
  'diegosouzapw/OmniRoute',
  '3e66ff2e8cc94821b093fe57dad667b585230cd1',
  'http://127.0.0.1:11434',
  'qwen3:4b',
  'npm ci',
  'npm run build',
  'Start OmniRoute and run real Ollama Qwen smoke in one step',
  'Persist receipt'
]) assert.ok(workflow.includes(token), token);

assert.strictEqual(evidence.status, 'PASS_REAL_OLLAMA_QWEN');
assert.strictEqual(evidence.provider, 'ollama');
assert.strictEqual(evidence.model, 'ollama/qwen3:4b');
assert.strictEqual(evidence.http_status, 200);
assert.strictEqual(evidence.marker, 'OMNIROUTE_QWEN_LIVE_OK');

console.log('OmniRoute Phase 5 hosted real provider contract: PASS');