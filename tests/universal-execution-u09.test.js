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

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.join(ROOT, file)), true, `required artifact missing: ${file}`);
}

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.name, 'aria-adapters');
assert.equal(typeof pkg.version, 'string');
assert.match(pkg.version, /^2\.5\.4$/);

const testScript = pkg.scripts?.test || '';
for (const id of ['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u10']) {
  assert.match(testScript, new RegExp(`universal-execution-${id}\\.test\\.js`), `npm test missing ${id}`);
}
assert.match(pkg.scripts?.['test:uo8-live'] || '', /universal-execution-u08-live\.test\.js/);
assert.match(pkg.scripts?.['test:uo10'] || '', /universal-execution-u10\.test\.js/);

const registry = JSON.parse(read('autonomy/universal-execution/registry.json'));
assert.deepEqual(registry.executors.map(e => e.executor_id), ['connector', 'device', 'agent']);
assert.equal(registry.executors.find(e => e.executor_id === 'connector').target_schema.connector_id, 'string');
assert.equal(registry.executors.find(e => e.executor_id === 'device').target_schema.device_id, 'string');
assert.equal(registry.executors.find(e => e.executor_id === 'agent').target_schema.agent_id, 'string');

const sourceFiles = requiredFiles
  .filter(file => file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.md'))
  .map(file => [file, read(file)]);
const forbiddenSecretPatterns = [
  /sk-[A-Za-z0-9_\-]{16,}/,
  /or-v1-[A-Za-z0-9_\-]{16,}/,
  /Bearer\s+[A-Za-z0-9._\-]{16,}/,
  /OPENROUTER_API_KEY\s*=/,
  /ARIA_RUNTIME_SHARED_SECRET\s*=/
];
for (const [file, content] of sourceFiles) {
  for (const pattern of forbiddenSecretPatterns) {
    assert.equal(pattern.test(content), false, `secret-shaped material found in ${file}`);
  }
}

const live = read('tests/universal-execution-u08-live.test.js');
assert.match(live, /aria-mission-runner-v5/);
assert.match(live, /completed_steps, 2/);
assert.match(live, /ARIA_REAL_RUNTIME_OK/);
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

const boundary = read('autonomy/universal-execution/dispatch-boundary.js');
assert.match(boundary, /scope_mismatch/);
assert.match(boundary, /operation_not_supported/);
assert.match(boundary, /sensitive_output_rejected/);
assert.match(boundary, /adapter_error/);
assert.match(boundary, /access[_-]?token/);

const boundaryContract = read('autonomy/universal-execution/dispatch-contract.md');
assert.match(boundaryContract, /UO-11\.4/);
assert.match(boundaryContract, /scope_mismatch/);
assert.match(boundaryContract, /sensitive_output_rejected/);
assert.match(boundaryContract, /adapter_error/);

console.log('UO-9 audit + no-regression structural tests passed');
