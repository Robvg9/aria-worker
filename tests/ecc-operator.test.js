'use strict';

const assert = require('assert');
const {
  ECC_VERSION,
  normalizeEccRequest,
  buildEccShellCommand,
  buildEccExecution,
} = require('../ecc/operator');

assert.strictEqual(ECC_VERSION, '2.2.3');

function decodeEccCommand(command) {
  const match = String(command).match(/Buffer\.from\('([^']+)'/);
  assert.ok(match, 'ECC command must use encoded Node runner source');
  return Buffer.from(match[1], 'base64').toString('utf8');
}

assert.deepStrictEqual(normalizeEccRequest({
  action: 'consult',
  topic: 'verification loop',
  target: 'codex'
}), { action: 'consult', topic: 'verification loop', target: 'codex' });

const consultCommand = buildEccShellCommand({ action: 'consult', topic: "a'b", target: 'codex' });
const consultSource = decodeEccCommand(consultCommand);
assert.ok(consultCommand.startsWith('node -e'));
assert.ok(consultSource.includes('const version="2.2.3"'));
assert.ok(consultSource.includes('ecc-universal@"+version'));
assert.ok(consultSource.includes('"consult",requestArgs') || consultSource.includes('requestArgs='));
assert.ok(consultSource.includes("a'b"));
assert.ok(consultSource.includes('"--target","codex"'));

const doctorSource = decodeEccCommand(buildEccShellCommand({ action: 'doctor', target: 'codex' }));
assert.ok(doctorSource.includes('const version="2.2.3"'));
assert.ok(doctorSource.includes('"doctor","--target","codex"'));

const listSource = decodeEccCommand(buildEccShellCommand({ action: 'list_installed' }));
assert.ok(listSource.includes('"list-installed"'));

const previewSource = decodeEccCommand(buildEccShellCommand({ action: 'install_preview', profile: 'core', target: 'codex' }));
assert.ok(previewSource.includes('"install","--profile","core","--target","codex","--dry-run"'));

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
assert.ok(decodeEccCommand(execution.command).includes('"doctor","--target","codex"'));

console.log('ecc-operator.test.js: PASS');
