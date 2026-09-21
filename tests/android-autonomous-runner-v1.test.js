'use strict';

const assert = require('node:assert/strict');
const { executeAutonomousAndroidMission } = require('../agents/termux/android-autonomous-runner-v1');

(async () => {
  const calls = [];
  let cycle = 0;
  const fakeApi = async (path, options) => {
    assert.equal(path, '/v1/android/autonomous/decide');
    const body = JSON.parse(options.body);
    calls.push({ type: 'decide', body });
    cycle += 1;
    if (cycle === 1) return {
      ok: true,
      decision: 'act',
      reason: 'Abrir el botón seguro',
      action: { action: 'click', nodeId: '0.0' },
      expectation: { text: 'Dashboard' }
    };
    return { ok: true, decision: 'pass', reason: 'Objetivo visible en la UI' };
  };
  const fakeAndroid = async ({ command }) => {
    const payload = JSON.parse(command);
    calls.push({ type: 'android', payload });
    if (payload.operation === 'observe') {
      return {
        status: 'succeeded',
        payload: {
          ok: true,
          packageName: 'com.android.chrome',
          root: { id: '0', role: 'text', children: [{ id: '0.0', role: 'button', text: cycle ? 'Dashboard' : 'Entrar', enabled: true, visible: true, children: [] }] },
          evidence_hash: 'before-hash'
        }
      };
    }
    return {
      status: 'succeeded',
      payload: {
        ok: true,
        ui: {
          ok: true,
          packageName: 'com.android.chrome',
          root: { id: '0', role: 'text', children: [{ id: '0.0', role: 'button', text: 'Dashboard', enabled: true, visible: true, children: [] }] }
        },
        evidence_hash: 'after-hash'
      }
    };
  };

  const result = await executeAutonomousAndroidMission({
    api: fakeApi,
    executeAndroidAccessibilityJob: fakeAndroid,
    goal: 'Prueba el flujo seguro de inicio',
    targetPackage: 'com.android.chrome',
    allowAnyApp: false,
    allowedHosts: ['aria.robvg9.workers.dev'],
    maxSteps: 3
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.steps, 1);
  assert.ok(result.trace.length >= 2);
  assert.ok(result.evidence.some(x => x.evidence_hash === 'after-hash'));
  assert.equal(calls[0].type, 'android');
  assert.equal(calls[1].type, 'decide');
  assert.equal(calls[2].type, 'android');
  console.log('ANDROID AUTONOMOUS RUNNER: PASS');
})().catch(error => { console.error(error); process.exit(1); });
