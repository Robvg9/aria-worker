'use strict';

const assert = require('assert');
const {
  validateStep,
  buildSandboxPlan,
  normalizeSandboxBranch
} = require('../autonomy/battlecruiser/sandbox-controller');

(function run() {
  const branch = 'aria/sandbox/bc4-proof';

  assert.strictEqual(normalizeSandboxBranch(branch), branch);
  assert.throws(() => normalizeSandboxBranch('main'), error => error.code === 'main_branch_forbidden');
  assert.throws(() => normalizeSandboxBranch('feature/random'), error => error.code === 'invalid_sandbox_branch');

  const inspect = validateStep({ phase: 'inspect', operation: 'repo_read', repo: 'Robvg9/battlecruiser' });
  assert.strictEqual(inspect.mode, 'read_only');

  const modify = validateStep({ phase: 'modify', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch });
  assert.strictEqual(modify.mode, 'sandbox_write');
  assert.strictEqual(modify.branch, branch);

  assert.throws(
    () => validateStep({ phase: 'modify', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch: 'main' }),
    error => error.code === 'main_branch_forbidden'
  );
  assert.throws(
    () => validateStep({ phase: 'branch_sandbox', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch }),
    error => error.code === 'branch_phase_requires_branch_create'
  );
  assert.throws(
    () => validateStep({ phase: 'inspect', operation: 'file_write', repo: 'Robvg9/battlecruiser' }),
    error => error.code === 'operation_not_allowed'
  );
  assert.throws(
    () => validateStep({ phase: 'modify', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch: 'aria/sandbox/bc4/../../main' }),
    error => error.code === 'invalid_sandbox_branch' || error.code === 'main_branch_forbidden'
  );

  const plan = buildSandboxPlan({
    repository: 'Robvg9/battlecruiser',
    sandboxBranch: branch,
    files: ['docs/BC4_probe.md', 'test/bc4_probe.test.js']
  });
  assert.strictEqual(plan[0].phase, 'inspect');
  assert.strictEqual(plan[1].phase, 'plan');
  assert.strictEqual(plan[2].phase, 'branch_sandbox');
  assert.strictEqual(plan[2].operation, 'branch_create');
  assert.strictEqual(plan[3].phase, 'modify');
  assert.strictEqual(plan[4].phase, 'modify');
  assert.strictEqual(plan[5].phase, 'regression');
  assert.strictEqual(plan[6].phase, 'evaluate');

  assert.throws(
    () => buildSandboxPlan({ repository: 'Robvg9/battlecruiser', sandboxBranch: branch, files: ['../main'] }),
    error => error.code === 'unsafe_file_path'
  );

  console.log('battlecruiser sandbox controller tests passed');
})();
