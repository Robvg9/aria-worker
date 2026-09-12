'use strict';

const assert = require('node:assert/strict');
const { verifyObservation, inferExpectation, verifyDesktopResult } = require('../autonomy/desktop-semantic-verifier');

const observed = {
  status: 'succeeded',
  focused_process: 'powershell',
  focused_title: 'Windows PowerShell',
  nodes: [
    { role: 'window', name: 'Windows PowerShell', visible: true, enabled: true },
    { role: 'edit', name: 'PowerShell', visible: true, enabled: true }
  ]
};

assert.equal(verifyObservation(observed, { focused_process: 'powershell' }).ok, true);
assert.equal(verifyObservation(observed, { focused_process: 'cmd' }).reason, 'focused_process_mismatch');
assert.equal(verifyObservation(observed, { required_nodes: [{ role: 'edit', name: 'PowerShell' }] }).ok, true);
assert.equal(verifyObservation(observed, { required_nodes: [{ role: 'button', name: 'Missing' }] }).reason, 'required_node_missing');
assert.equal(verifyObservation(observed, { forbidden_nodes: [{ role: 'edit', name: 'PowerShell' }] }).reason, 'forbidden_node_present');

assert.deepEqual(inferExpectation({ operation: 'computer.use', input: { action: 'focus', process: 'powershell' } }), { focused_process: 'powershell' });
assert.deepEqual(inferExpectation({ operation: 'shell.execute', input: { command: 'Get-Date' } }), {});

assert.equal(verifyDesktopResult({ step: { operation: 'computer.use', input: { action: 'focus', process: 'powershell' } }, result: { status: 'succeeded' }, observation: observed }).ok, true);
assert.equal(verifyDesktopResult({ step: { operation: 'computer.use', input: { action: 'focus', process: 'powershell' } }, result: { status: 'failed' }, observation: observed }).ok, false);
assert.equal(verifyDesktopResult({ step: { operation: 'computer.use', input: { action: 'focus', process: 'powershell' } }, result: { status: 'succeeded' }, observation: { focused_process: 'cmd', nodes: [] } }).ok, false);

console.log('DESKTOP SEMANTIC VERIFIER: PASS');
