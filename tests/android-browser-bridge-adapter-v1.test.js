'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAndroidBrowserBridgeAdapter,
  toUiState,
  actionToNative
} = require('../computer-use/android-browser-bridge-adapter-v1');
const { createComputerRuntime } = require('../computer-use/runtime-v1');

function bridgePayload({ clicked = false } = {}) {
  return {
    ok: true,
    packageName: 'com.android.chrome',
    evidence_hash: clicked ? 'after-hash' : 'before-hash',
    root: {
      id: '0',
      role: 'text',
      text: null,
      children: [
        {
          id: '0.0',
          role: 'button',
          name: null,
          text: clicked ? 'Dashboard' : 'Entrar',
          label: 'Entrar',
          enabled: true,
          visible: true,
          focused: false,
          clickable: true,
          children: []
        },
        {
          id: '0.1',
          role: 'textbox',
          name: 'Correo',
          text: 'robert@example.invalid',
          label: 'Correo',
          enabled: true,
          visible: true,
          focused: true,
          clickable: false,
          children: []
        },
        {
          id: '0.2',
          role: 'textbox',
          name: 'Password',
          text: null,
          label: null,
          enabled: true,
          visible: true,
          focused: false,
          clickable: false,
          children: []
        }
      ]
    }
  };
}

function makeDispatcher() {
  const calls = [];
  let clicked = false;

  return {
    calls,
    async execute({ step }) {
      calls.push(step);
      assert.equal(step.operation, 'shell.execute');
      assert.equal(step.target.device_id, 'android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092');

      if (step.command.includes('/v1/observe')) {
        return {
          status: 'succeeded',
          stdout: JSON.stringify(bridgePayload({ clicked })) + '\nARIA_HTTP_STATUS:200\n',
          stderr: ''
        };
      }

      if (step.command.includes('/v1/action')) {
        assert.match(step.command, /127\.0\.0\.1:43817\/v1\/action/);
        clicked = true;
        return {
          status: 'succeeded',
          stdout: JSON.stringify({
            ok: true,
            ui: bridgePayload({ clicked }),
            evidence_hash: 'after-hash'
          }) + '\nARIA_HTTP_STATUS:200\n',
          stderr: ''
        };
      }

      throw new Error('unexpected command');
    }
  };
}

test('normalizes a real accessibility-shaped tree into ui-state-v1', () => {
  const ui = toUiState(bridgePayload());
  assert.equal(ui.surface, 'android-browser');
  assert.equal(ui.nodes.length, 4);
  assert.equal(ui.focused_id, '0.1');
  assert.equal(ui.nodes.find(n => n.id === '0.0').role, 'button');
  assert.equal(ui.metadata.package_name, 'com.android.chrome');
});

test('runs computer-use observe -> plan -> physical adapter -> verify', async () => {
  const dispatcher = makeDispatcher();
  const adapter = createAndroidBrowserBridgeAdapter({
    deviceDispatcher: dispatcher,
    device_id: 'android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092'
  });

  const runtime = createComputerRuntime({ adapter });
  const result = await runtime.executeMission({
    mission_id: 'rwht-android-adapter-contract-1',
    intent: 'press Entrar',
    target: {
      role: 'button',
      text: 'Entrar',
      action: 'click'
    },
    risk: 'low_risk_write'
  });

  assert.equal(result.status, 'succeeded');
  assert.ok(result.ui);
  assert.equal(dispatcher.calls.length, 2);
  assert.match(dispatcher.calls[0].command, /\/v1\/observe/);
  assert.match(dispatcher.calls[1].command, /\/v1\/action/);
});

test('blocks secret-shaped native typing and unsupported select', () => {
  assert.throws(
    () => actionToNative({
      action: 'type',
      target: { ref: '0.2' },
      text: 'sk-12345678901234567890'
    }),
    /secret_material|credential/
  );

  assert.throws(
    () => actionToNative({
      action: 'type',
      target: { ref: '0.2' },
      text: 'not-a-secret',
      metadata: { credential_ref: 'secret://supabase/login' }
    }),
    /credential_ref_requires_secure_device_transport/
  );

  assert.throws(
    () => actionToNative({
      action: 'select',
      target: { ref: '0.3' }
    }),
    /select_not_supported/
  );
});
