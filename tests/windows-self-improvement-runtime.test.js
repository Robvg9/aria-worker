'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const runtimePath = path.join(__dirname, '..', 'agents', 'windows', 'self-improvement-runtime.js');
const agentPath = path.join(__dirname, '..', 'agents', 'windows', 'aria-agent.js');
const installPath = path.join(__dirname, '..', 'agents', 'windows', 'install-v2.ps1');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const agent = fs.readFileSync(agentPath, 'utf8');
const install = fs.readFileSync(installPath, 'utf8');

assert.match(runtime, /createSelfImprovementCoordinatorV1/);
assert.match(runtime, /operation !== 'self\.improve'/);
assert.match(runtime, /SAFE_CATEGORIES/);
assert.match(runtime, /self-improvement-workspace/);
assert.match(runtime, /change\.risk_level/);
assert.match(runtime, /process\.execPath,\['--check'/);
assert.match(runtime, /promotion:\s*'human_gate'/);
assert.match(runtime, /deployment:\s*'human_gate'/);
assert.match(runtime, /coordinator_status:\s*result\.status/);
assert.match(runtime, /stop_reason:\s*result\.stop_reason/);
assert.match(runtime, /sandbox:\s*true/);
assert.match(agent, /SELF_IMPROVEMENT_OPERATION='self\.improve'/);
assert.match(agent, /executeSelfImprovementJobOnDevice/);
assert.match(agent, /job\.operation===SELF_IMPROVEMENT_OPERATION/);
assert.doesNotMatch(agent, /SELF_IMPROVEMENT_OPERATION\) return executeShellJob/);
assert.match(install, /self-improvement-runtime\.js/);
assert.match(install, /@\('autonomy','self-development','self-model'\)/);
assert.match(install, /SELF_IMPROVEMENT_RUNTIME_LOAD=PASS/);
console.log('WINDOWS_SELF_IMPROVEMENT_RUNTIME_OK');
