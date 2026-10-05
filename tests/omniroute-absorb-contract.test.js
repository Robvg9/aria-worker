'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'absorb/omniroute/SOURCE_LOCK.json'), 'utf8'));
const integration = fs.readFileSync(path.join(root, 'absorb/omniroute/INTEGRATION_CONTRACT.md'), 'utf8');
const phase3 = fs.readFileSync(path.join(root, 'absorb/omniroute/PHASE_3_SANDBOX_CONTRACT.md'), 'utf8');
const phase4 = fs.readFileSync(path.join(root, 'absorb/omniroute/PHASE_4_STANDALONE_CONTRACT.md'), 'utf8');
const phase3Workflow = fs.readFileSync(path.join(root, '.github/workflows/omniroute-phase3-hosted-windows.yml'), 'utf8');
const phase4Workflow = fs.readFileSync(path.join(root, '.github/workflows/omniroute-phase4-standalone-hosted.yml'), 'utf8');
const phase5Workflow = fs.readFileSync(path.join(root, '.github/workflows/omniroute-phase5-hosted-real.yml'), 'utf8');

const checks = [
  ['source repository pinned', lock.source.repository === 'diegosouzapw/OmniRoute'],
  ['release ref pinned', lock.source.ref === 'release/v3.8.52'],
  ['exact commit pinned', lock.source.commit_sha === '3e66ff2e8cc94821b093fe57dad667b585230cd1'],
  ['runtime disabled before later integration', lock.runtime_enabled === false],
  ['external execution fail-closed', lock.execution_policy.external_code_execution === false],
  ['downloaded code execution fail-closed', lock.execution_policy.downloaded_code_execution === false],
  ['phase 3 hosted PASS', lock.gates.phase_3_sandbox === 'PASS_HOSTED_WINDOWS'],
  ['phase 4 hosted PASS', lock.gates.phase_4_standalone === 'PASS_HOSTED_WINDOWS'],
  ['phase 5 hosted real PASS', lock.gates.phase_5_provider_hosted_real === 'PASS_HOSTED_WINDOWS'],
  ['ARIA remains authority', /Planner|Permissions|Mission|Evidence|Persistence|Learning/i.test(integration)],
  ['phase 3 contract certified', phase3.includes('Status: PASS — HOSTED WINDOWS CERTIFIED')],
  ['phase 4 contract certified', phase4.includes('Status: PASS — HOSTED WINDOWS CERTIFIED')],
  ['phase 3 workflow locked', phase3Workflow.includes('3e66ff2e8cc94821b093fe57dad667b585230cd1')],
  ['phase 4 restart exists', phase4Workflow.includes('Restart exact OmniRoute with same data')],
  ['phase 4 persistence exists', phase4Workflow.includes('Persist final Phase 4 evidence')],
  ['phase 5 real hosted workflow exists', phase5Workflow.includes('Start OmniRoute and run real Ollama Qwen smoke in one step')],
  ['phase 5 source locked', phase5Workflow.includes('3e66ff2e8cc94821b093fe57dad667b585230cd1')],
];

for (const [name, pass] of checks) {
  assert.ok(pass, name);
  console.log('PASS ' + name);
}

console.log('\nOmniRoute ABSORB integration contract: ' + checks.length + ' passed, 0 failed');