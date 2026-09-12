'use strict';

const assert = require('node:assert/strict');
const { createDesktopSemanticRuntimeVerifier } = require('../autonomy/desktop-semantic-runtime');

const calls = [];
const deviceDispatcher = {
  async execute({ step }) {
    calls.push(step);
    return {
      status: 'succeeded',
      observation: {
        focused_process: 'powershell',
        nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true, enabled: true }]
      }
    };
  }
};

const verifier = createDesktopSemanticRuntimeVerifier({ deviceDispatcher });

const result = await verifier.verify({
  missionId: 'm1',
  mission: { mission_id: 'm1' },
  step: {
    id: 's1',
    operation: 'computer.use',
    target: { type: 'device', device_id: 'windows-local' },
    input: { action: 'focus', process: 'powershell' }
  },
  result: { status: 'succeeded' },
  attempt: 1
});

assert.equal(result.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].input.action, 'observe');
assert.equal(calls[0].target.device_id, 'windows-local');

const readOnly = await verifier.verify({
  missionId: 'm1',
  mission: { mission_id: 'm1' },
  step: {
    id: 's2',
    operation: 'shell.execute',
    target: { type: 'device', device_id: 'windows-local' },
    command: 'Get-Date'
  },
  result: { status: 'succeeded' }
});
assert.equal(readOnly, true);
assert.equal(calls.length, 1);

const baseBlocked = createDesktopSemanticRuntimeVerifier({
  deviceDispatcher,
  baseVerify: async () => ({ ok: false, reason: 'base_verifier_blocked' })
});
const blocked = await baseBlocked.verify({
  missionId: 'm1',
  mission: {},
  step: { id: 's3', operation: 'computer.use', target: { device_id: 'windows-local' }, input: { action: 'focus', process: 'powershell' } },
  result: { status: 'succeeded' }
});
assert.deepEqual(blocked, { ok: false, reason: 'base_verifier_blocked' });
assert.equal(calls.length, 1);

console.log('DESKTOP SEMANTIC RUNTIME: PASS');
