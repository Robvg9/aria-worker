'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {
  MIN_LOCAL_LLM_RAM_BYTES,
  MIN_LOCAL_LLM_LOGICAL_CPUS,
  getWindowsResourceProfile,
} = require('../agents/windows/resource-profile');

test('LaCueva-class hardware is worker-light', () => {
  const profile = getWindowsResourceProfile({
    totalMemoryBytes: 3.93 * 1024 ** 3,
    logicalCpus: 2,
  });
  assert.equal(profile.profile, 'worker-light');
  assert.equal(profile.local_llm_eligible, false);
  assert.match(profile.guard_reason, /requires_at_least_8gb_ram_and_4_logical_cpus/);
});

test('12 GB / 4 logical CPU Windows node remains eligible for local LLM', () => {
  const profile = getWindowsResourceProfile({
    totalMemoryBytes: 12 * 1024 ** 3,
    logicalCpus: 4,
  });
  assert.equal(profile.profile, 'standard');
  assert.equal(profile.local_llm_eligible, true);
  assert.equal(profile.guard_reason, 'eligible');
});

test('installer no longer hard-codes the legacy Windows identity', () => {
  const installer = fs.readFileSync(require.resolve('../agents/windows/install-v2.ps1'), 'utf8');
  assert.match(installer, /param\(\s*\[string\]\$DeviceId\s*=\s*\$env:ARIA_DEVICE_ID/s);
  assert.match(installer, /ARIA_DEVICE_ID is required/);
  assert.doesNotMatch(installer, /windows-fe722cc6681e4f9c9cc35f5ebbb0a089/);
  assert.match(installer, /ollama_enabled\s*=\s*\$localLlmEligible/);
  assert.match(installer, /resource-profile\.js/);
  const agent = fs.readFileSync(require.resolve('../agents/windows/aria-agent.js'), 'utf8');
  const autonomous = fs.readFileSync(require.resolve('../agents/windows/autonomous-rwht-controller.js'), 'utf8');
  assert.match(agent, /const capabilities=\[SHELL_OPERATION,COMPUTER_OPERATION,AUTONOMOUS_COMPUTER_OPERATION\]/);
  assert.match(agent, /if\(OLLAMA_ENABLED\)capabilities\.unshift\(OLLAMA_OPERATION\)/);
  assert.match(agent, /const deterministicPwaRwht=.*PWA\\s\+LIVE/);
  assert.match(agent, /local_llm_resource_guard/);
  assert.match(autonomous, /local_llm_resource_guard/);
});

assert.ok(MIN_LOCAL_LLM_RAM_BYTES > 0);
assert.equal(MIN_LOCAL_LLM_LOGICAL_CPUS, 4);

const workflow = fs.readFileSync(
  require.resolve('../.github/workflows/aria-windows-runtime-repair.yml'),
  'utf8'
);
test('Windows runtime repair targets only the canonical LaCueva identity', () => {
  assert.match(workflow, /Guard physical runner identity before maintenance/);
  assert.match(workflow, /expected='windows-lacueva-780886'/);
  const guard = workflow.indexOf("Guard physical runner identity before maintenance");
  const cleanup = workflow.indexOf("Safe C cleanup and relocate ARIA caches to D");
  assert.ok(guard >= 0 && cleanup > guard, 'runner identity guard must precede maintenance');
  assert.match(workflow, /if:\s*github\.event_name\s*!=\s*'pull_request'/);
});
test('Windows runtime repair syncs the resource profile with the agent', () => {
  assert.match(workflow, /agents\\windows\\resource-profile\.js/);
  assert.match(workflow, /resource-profile\.js/);
  assert.match(workflow, /WINDOWS_RESOURCE_PROFILE_CHANGED=/);
});
