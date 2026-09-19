'use strict';

const assert = require('node:assert/strict');
const {
  createAndroidBrowserBridgeAdapter,
  toUiState,
  actionToNative
} = require('../computer-use/android-browser-bridge-adapter-v1');
const { createUiState, createComputerRuntime } = require('../computer-use/runtime-v1');

const DEVICE_ID = 'android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092';

function bridgePayload(clicked = false) {
  return {
    ok: true,
    packageName: 'com.android.chrome',
    evidence_hash: clicked ? 'after' : 'before',
    root: {
      id: '0',
      role: 'text',
      children: [
        {
          id: '0.0',
          role: 'button',
          text: clicked ? 'Dashboard' : 'Entrar',
          label: 'Entrar',
          enabled: true,
          visible: true,
          clickable: true
        }
      ]
    }
  };
}

async function main() {
  const initial = toUiState(bridgePayload(false));
  assert.equal(initial.surface, 'android-browser');
  assert.equal(initial.nodes.length, 2);
  assert.equal(initial.nodes[1].text, 'Entrar');
  assert.equal(initial.metadata.package_name, 'com.android.chrome');

  const calls = [];
  let clicked = false;

  const dispatcher = {
    async execute({ step }) {
      calls.push(step);
      assert.equal(step.operation, 'computer.use.android');
      assert.equal(step.target.device_id, DEVICE_ID);

      const payload = JSON.parse(step.command);

      if (payload.action === 'observe') {
        return {
          status: 'succeeded',
          result: {
            status: 'succeeded',
            result: bridgePayload(clicked),
            duration_ms: 5
          }
        };
      }

      assert.deepEqual(payload, {
        action: {
          action: 'click',
          nodeId: '0.0'
        }
      });

      clicked = true;
      return {
        status: 'succeeded',
        result: {
          status: 'succeeded',
          result: {
            ok: true,
            ui: bridgePayload(true),
            evidence_hash: 'after'
          },
          duration_ms: 5
        }
      };
    }
  };

  const adapter = createAndroidBrowserBridgeAdapter({
    deviceDispatcher: dispatcher,
    device_id: DEVICE_ID
  });

  const runtime = createComputerRuntime({ adapter });
  const result = await runtime.executeMission({
    mission_id: 'rwht-android-adapter-targeted',
    intent: 'Press Entrar',
    target: { role: 'button', text: 'Entrar', action: 'click' },
    risk: 'low_risk_write'
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.ui.nodes[1].text, 'Dashboard');
  assert.equal(calls.length, 2);

  const secure = actionToNative({
    action: 'type',
    target: { ref: '0.2' },
    metadata: { credential_ref: 'secret://rwht/rwht_android_password' }
  });
  assert.equal(secure.secret_ref, 'secret://rwht/rwht_android_password');
  assert.equal(secure.action.text, undefined);

  assert.throws(
    () => actionToNative({
      action: 'type',
      target: { ref: '0.2' },
      text: 'sk-12345678901234567890'
    }),
    /secret_material|credential/
  );

  assert.throws(
    () => actionToNative({ action: 'select', target: { ref: '0.2' } }),
    /select_not_supported/
  );

  // Ensure normalization itself still satisfies the runtime's ui-state contract.
  createUiState({
    surface: 'android-browser',
    nodes: [{ id: 'x', role: 'text', text: 'safe' }]
  });

  console.log('ANDROID PHYSICAL ADAPTER CONTRACT: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
