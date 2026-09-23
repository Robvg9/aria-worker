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

  const passWithoutAction = await executeAutonomousAndroidMission({
    api: async () => ({ ok: true, decision: 'pass', reason: 'No action performed' }),
    executeAndroidAccessibilityJob: async ({ command }) => {
      const payload = JSON.parse(command);
      assert.equal(payload.operation, 'observe');
      return {
        status: 'succeeded',
        payload: {
          ok: true,
          packageName: 'com.android.chrome',
          root: { id: '0', role: 'text', children: [] },
          evidence_hash: 'observe-only-hash'
        }
      };
    },
    goal: 'No-pass-without-action',
    targetPackage: 'com.android.chrome',
    allowAnyApp: false,
    allowedHosts: ['aria.robvg9.workers.dev'],
    maxSteps: 1
  });

  assert.equal(passWithoutAction.status, 'failed');
  assert.equal(passWithoutAction.reason, 'android_autonomous_pass_without_verified_action');


  const noVisibleChange = await executeAutonomousAndroidMission({
    api: async () => ({
      ok: true,
      decision: 'act',
      reason: 'Click should visibly change the UI',
      action: { action: 'click', nodeId: '0.0' }
    }),
    executeAndroidAccessibilityJob: async ({ command }) => {
      const payload = JSON.parse(command);
      if (payload.operation === 'observe') {
        return {
          status: 'succeeded',
          payload: {
            ok: true,
            packageName: 'com.android.chrome',
            root: { id: '0', role: 'text', children: [{ id: '0.0', role: 'button', text: 'Chat', enabled: true, visible: true, children: [] }] },
            evidence_hash: 'same-ui-hash'
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
            root: { id: '0', role: 'text', children: [{ id: '0.0', role: 'button', text: 'Chat', enabled: true, visible: true, children: [] }] },
            evidence_hash: 'same-ui-hash'
          },
          // Deliberately different transport/response hash: this must NOT count as a UI change.
          evidence_hash: 'different-response-hash'
        }
      };
    },
    goal: 'Detect no visible UI change',
    targetPackage: 'com.android.chrome',
    allowAnyApp: false,
    allowedHosts: ['aria.robvg9.workers.dev'],
    maxSteps: 2
  });

  assert.equal(noVisibleChange.status, 'failed');
  assert.equal(noVisibleChange.reason, 'android_action_no_visible_state_change');
  assert.equal(noVisibleChange.trace[0].execution.status, 'failed');
  assert.equal(noVisibleChange.trace[0].execution.after_evidence_hash, 'same-ui-hash');
  assert.equal(noVisibleChange.trace[0].execution.response_evidence_hash, 'different-response-hash');

  console.log('ANDROID AUTONOMOUS RUNNER: PASS');
})().catch(error => { console.error(error); process.exit(1); });
