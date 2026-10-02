'use strict';

const assert = require('assert');
const {
  ECC_VERSION,
  normalizeEccRequest,
  buildEccShellCommand,
  buildEccExecution,
} = require('../ecc/operator');

assert.strictEqual(ECC_VERSION, '2.2.3');

assert.deepStrictEqual(normalizeEccRequest({
  action: 'consult',
  topic: 'verification loop',
  target: 'codex'
}), { action: 'consult', topic: 'verification loop', target: 'codex' });

assert.ok(buildEccShellCommand({ action: 'consult', topic: "a'b", target: 'codex' }).includes('ecc-universal@2.2.3'));
assert.ok(buildEccShellCommand({ action: 'consult', topic: "a'b", target: 'codex' }).startsWith('node -e'));
assert.ok(buildEccShellCommand({ action: 'doctor', target: 'codex' }).includes('ecc-universal@2.2.3'));
assert.ok(buildEccShellCommand({ action: 'doctor', target: 'codex' }).includes('doctor'));
assert.ok(buildEccShellCommand({ action: 'doctor', target: 'codex' }).includes('--target'));


assert.ok(buildEccShellCommand({ action: 'list_installed' }).includes('list-installed'));

assert.ok(buildEccShellCommand({ action: 'install_preview', profile: 'core', target: 'codex' }).includes('--dry-run'));

assert.throws(
  () => normalizeEccRequest({ action: 'run', command: 'whoami' }),
  /ecc_action_not_allowed/
);
assert.throws(
  () => normalizeEccRequest({ action: 'consult', topic: 'x', target: 'powershell' }),
  /ecc_target_not_allowed/
);
assert.throws(
  () => normalizeEccRequest({ action: 'consult', topic: '' }),
  /ecc_consult_topic_invalid/
);
assert.throws(
  () => normalizeEccRequest({ action: 'install_preview', profile: 'full' }),
  /ecc_profile_not_allowed/
);

const execution = buildEccExecution({ action: 'doctor', target: 'codex' });
assert.strictEqual(execution.tool_id, 'tool_ecc_operator');
assert.strictEqual(execution.operation, 'ecc.execute');
assert.strictEqual(execution.underlying_operation, 'shell.execute');
assert.ok(execution.command.includes('doctor'));

console.log('ecc-operator.test.js: PASS');
