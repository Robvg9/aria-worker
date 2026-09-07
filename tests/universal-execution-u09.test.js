'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const requiredFiles = [
  'autonomy/universal-execution/registry.json',
  'autonomy/universal-execution/contract.md',
  'autonomy/universal-execution/dispatch-contract.md',
  'autonomy/universal-execution/lookup.js',
  'autonomy/universal-execution/selector.js',
  'autonomy/universal-execution/plan.js',
  'autonomy/universal-execution/control.js',
  'autonomy/universal-execution/dispatch-boundary.js',
  'autonomy/universal-execution/adapters/index.js',
  'autonomy/universal-execution/adapters/connector.js',
  'autonomy/universal-execution/adapters/device.js',
  'autonomy/universal-execution/adapters/agent.js',
  'supabase/functions/aria-mission-runner-v22/index.ts',
  'supabase/migrations/20260907_universal_execution_lease_fencing.sql',
  'tests/universal-execution-u01.test.js',
  'tests/universal-execution-u02.test.js',
  'tests/universal-execution-u03.test.js',
  'tests/universal-execution-u04.test.js',
  'tests/universal-execution-u05.test.js',
  'tests/universal-execution-u06.test.js',
  'tests/universal-execution-u07.test.js',
  'tests/universal-execution-u08-live.test.js',
  'tests/universal-execution-u10.test.js'
];

for (const file of requiredFiles) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `required artifact missing: ${file}`);

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.name, 'aria-adapters');
assert.equal(pkg.version, '2.6.8');
const testScript = pkg.scripts?.test || '';
for (const id of ['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u10', 'u09']) {
  assert.match(testScript, new RegExp(`universal-execution-${id}\\.test\\.js`), `npm test missing ${id}`);
}

const registry = JSON.parse(read('autonomy/universal-execution/registry.json'));
assert.deepEqual(registry.executors.map(e => e.executor_id), ['connector', 'device', 'agent', 'model']);
assert.equal(registry.executors.find(e => e.executor_id === 'connector').target_schema.connector_id, 'string');
assert.equal(registry.executors.find(e => e.executor_id === 'device').target_schema.device_id, 'string');
assert.equal(registry.executors.find(e => e.executor_id === 'agent').target_schema.agent_id, 'string');
assert.equal(registry.executors.find(e => e.executor_id === 'model').target_schema.model_id, 'string');
assert.equal(registry.executors.find(e => e.executor_id === 'model').operations.includes('text_generation'), true);
assert.equal(registry.executors.find(e => e.executor_id === 'model').availability, 'available');

const sourceFiles = requiredFiles
  .filter(file => file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.md') || file.endsWith('.ts'))
  .map(file => [file, read(file)]);
const forbiddenSecretPatterns = [
  /sk-[A-Za-z0-9_\-]{16,}/,
  /or-v1-[A-Za-z0-9_\-]{16,}/,
  /Bearer\s+[A-Za-z0-9._\-]{16,}/,
  /OPENROUTER_API_KEY\s*=/,
  /ARIA_RUNTIME_SHARED_SECRET\s*=/
];
for (const [file, content] of sourceFiles) {
  for (const pattern of forbiddenSecretPatterns) assert.equal(pattern.test(content), false, `secret-shaped material found in ${file}`);
}

const live = read('tests/universal-execution-u08-live.test.js');
assert.match(live, /completed_steps, 2/);
assert.match(live, /shell\.execute/);

const control = read('autonomy/universal-execution/control.js');
assert.match(control, /human_gate_required/);
assert.match(control, /blocked/);

const plan = read('autonomy/universal-execution/plan.js');
assert.match(plan, /depends_on/);
assert.match(plan, /cycle/);

const selector = read('autonomy/universal-execution/selector.js');
assert.match(selector, /connector_id/);
assert.match(selector, /device_id/);
assert.match(selector, /agent_id/);
assert.match(selector, /model_id/);
assert.match(selector, /unknown_executor_type/);
assert.match(selector, /ambiguous_executor_selection/);

const boundary = read('autonomy/universal-execution/dispatch-boundary.js');
assert.match(boundary, /scope_mismatch/);
assert.match(boundary, /operation_not_supported/);
assert.match(boundary, /sensitive_output_rejected/);
assert.match(boundary, /adapter_error/);
assert.match(boundary, /access[_-]?token/);

const runner = read('supabase/functions/aria-mission-runner-v22/index.ts');
assert.match(runner, /aria_mission_claim_by_id_lease/);
assert.match(runner, /aria_mission_claim_next_lease/);
assert.match(runner, /aria_internal\.aria_mission_renew_lease/);
assert.match(runner, /aria_mission_update_lease/);
assert.match(runner, /aria_mission_append_event_lease/);
assert.match(runner, /step_retrying/);
assert.match(runner, /MAX_STEP_ATTEMPTS/);
assert.match(runner, /verifyStep/);
assert.match(runner, /universal_execution_verified/);
assert.match(runner, /failed_steps/);
assert.doesNotMatch(runner, /aria_mission_update\("/);
assert.doesNotMatch(runner, /aria_mission_append_event\("/);

const migration = read('supabase/migrations/20260907_universal_execution_lease_fencing.sql');
assert.match(migration, /aria_mission_renew_lease/);
assert.match(migration, /aria_mission_update_lease/);
assert.match(migration, /aria_mission_append_event_lease/);
assert.match(migration, /lease_owner = p_worker_id/);
assert.match(migration, /lease_until/);
assert.match(migration, /revoke all on function/);

const boundaryContract = read('autonomy/universal-execution/dispatch-contract.md');
assert.match(boundaryContract, /UO-11\.4/);
assert.match(boundaryContract, /scope_mismatch/);
assert.match(boundaryContract, /sensitive_output_rejected/);
assert.match(boundaryContract, /adapter_error/);

console.log('UO-9 audit + no-regression structural tests passed');
