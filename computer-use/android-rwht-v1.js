'use strict';

const crypto = require('node:crypto');

const DEFAULT_PWA_URL = 'https://aria.robvg9.workers.dev/pwa/';
const DEVICE_ID = 'android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092';
const MOBILE_NETWORK_GATE = 'BLOCKED_NETWORK_SHAPING_UNAVAILABLE';
const RECOVERY_GATE = 'BLOCKED_PHYSICAL_RECOVERY_NOT_YET_EXERCISED';

const SECRET_REF_PATTERN = /^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/;

function buildRwhtAndroidV1Plan({
  pwaUrl = DEFAULT_PWA_URL,
  expectedBuild = null,
  secretRefs
} = {}) {
  if (!secretRefs?.email || !secretRefs?.password) {
    throw new Error('rwht_secret_refs_required');
  }
  if (!SECRET_REF_PATTERN.test(secretRefs.email) || !SECRET_REF_PATTERN.test(secretRefs.password)) {
    throw new Error('rwht_secret_ref_invalid');
  }

  const buildExpectation = expectedBuild ? { text: expectedBuild } : {};
  const loginFields = [
    { role: 'textbox', label: 'Correo' },
    { role: 'textbox', label: 'Contraseña' }
  ];

  return Object.freeze([
    {
      id: 'A-open-pwa',
      intent: 'Open canonical ARIA PWA',
      action: { action: 'navigate', value: { url: pwaUrl } },
      expectation: { present: loginFields, ...buildExpectation }
    },
    {
      id: 'B-settle-and-build',
      intent: 'Wait for login UI to settle and verify the expected live build',
      action: { action: 'wait', value: { ms: 1500 } },
      expectation: { present: loginFields, ...buildExpectation }
    },
    {
      id: 'D1-email',
      intent: 'Enter email via governed credential reference',
      action: {
        action: 'type',
        target: { role: 'textbox', label: 'Correo' },
        metadata: { credential_ref: secretRefs.email }
      },
      expectation: { present: [{ role: 'textbox', label: 'Correo' }] }
    },
    {
      id: 'D2-password',
      intent: 'Enter password via governed credential reference',
      action: {
        action: 'type',
        target: { role: 'textbox', label: 'Contraseña' },
        metadata: { credential_ref: secretRefs.password }
      },
      expectation: { present: [{ role: 'textbox', label: 'Contraseña' }] }
    },
    {
      id: 'D3-login',
      intent: 'Press the real login control',
      action: { action: 'click', target: { role: 'button', text: 'ENTRAR EN ARIA' } },
      expectation: {
        present: [
          { role: 'button', text: 'Nueva misión' },
          { role: 'button', text: 'Meditación IA' },
          { role: 'button', text: 'Capacidades' }
        ],
        text: 'Centro de Mando'
      }
    },
    {
      id: 'E-dashboard',
      intent: 'Verify the real dashboard after login',
      action: { action: 'wait', value: { ms: 800 } },
      expectation: {
        present: [
          { role: 'button', text: 'Nueva misión' },
          { role: 'button', text: 'Meditación IA' },
          { role: 'button', text: 'Capacidades' },
          { role: 'button', text: 'Salir' }
        ],
        text: 'Centro de Mando'
      }
    },
    {
      id: 'F-models',
      intent: 'Open Modelos disponibles',
      action: { action: 'click', target: { role: 'button', text: 'Modelos disponibles' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] }
    },
    {
      id: 'F-models-close',
      intent: 'Close Modelos disponibles',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } }
    },
    {
      id: 'G-agents',
      intent: 'Open Agentes disponibles',
      action: { action: 'click', target: { role: 'button', text: 'Agentes disponibles' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] }
    },
    {
      id: 'G-agents-close',
      intent: 'Close Agentes disponibles',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } }
    },
    {
      id: 'H-devices',
      intent: 'Open Dispositivos online',
      action: { action: 'click', target: { role: 'button', text: 'Dispositivos online' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] }
    },
    {
      id: 'H-devices-close',
      intent: 'Close Dispositivos online',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } }
    },
    {
      id: 'I-connections',
      intent: 'Open Conexiones',
      action: { action: 'click', target: { role: 'button', text: 'Conexiones' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] }
    },
    {
      id: 'I-connections-close',
      intent: 'Close Conexiones',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } }
    },
    {
      id: 'J-conversation-focus',
      intent: 'Focus the real direct conversation input',
      action: { action: 'click', target: { role: 'textbox', label: 'Habla con ARIA…' } },
      expectation: { present: [{ role: 'textbox', label: 'Habla con ARIA…' }] }
    },
    {
      id: 'J-conversation-type',
      intent: 'Write a real human conversation request',
      action: {
        action: 'type',
        target: { role: 'textbox', label: 'Habla con ARIA…' },
        text: 'Responde exactamente: RWHT_ANDROID_CONVERSATION_OK',
        risk: 'low_risk_write'
      },
      expectation: { present: [{ role: 'textbox', label: 'Habla con ARIA…' }] }
    },
    {
      id: 'J-conversation-send',
      intent: 'Send the real conversation request',
      action: {
        action: 'click',
        target: { role: 'button', text: '↑' },
        risk: 'low_risk_write'
      },
      expectation: { text: 'RWHT_ANDROID_CONVERSATION_OK' }
    },
    {
      id: 'J-conversation-verify',
      intent: 'Wait for the real conversation response',
      action: { action: 'wait', value: { ms: 2500 } },
      expectation: { text: 'RWHT_ANDROID_CONVERSATION_OK' }
    },
    {
      id: 'K-new-mission-open',
      intent: 'Open the real low-risk mission form',
      action: { action: 'click', target: { role: 'button', text: 'Nueva misión' } },
      expectation: { text: '¿Qué debe hacer ARIA?' }
    },
    {
      id: 'K-new-mission-type',
      intent: 'Enter a real low-risk mission through the UI',
      action: {
        action: 'type',
        target: {
          role: 'textbox',
          label: 'Ejemplo: revisa el estado de X y dime qué está mal.'
        },
        text: 'Responde exactamente: RWHT_ANDROID_MISSION_OK y no hagas cambios externos.',
        risk: 'low_risk_write'
      },
      expectation: { text: '¿Qué debe hacer ARIA?' }
    },
    {
      id: 'K-new-mission-create',
      intent: 'Create the real low-risk mission',
      action: {
        action: 'click',
        target: { role: 'button', text: 'Crear misión' },
        risk: 'low_risk_write'
      },
      expectation: { text: 'EJECUCIÓN ACTUAL' }
    },
    {
      id: 'K-new-mission-result',
      intent: 'Wait for the real mission result and verify it',
      action: { action: 'wait', value: { ms: 5000 } },
      expectation: { text: 'RWHT_ANDROID_MISSION_OK' }
    },
    {
      id: 'L-meditation',
      intent: 'Enter Meditación IA',
      action: { action: 'click', target: { role: 'button', text: 'Meditación IA' } },
      expectation: {
        present: [{ role: 'button', text: '← Centro' }],
        text: 'MEDITACIÓN IA'
      }
    },
    {
      id: 'L-meditation-data',
      intent: 'Verify Meditación IA data is actually visible',
      action: { action: 'wait', value: { ms: 1000 } },
      expectation: { text: 'Misiones visibles' }
    },
    {
      id: 'L-back',
      intent: 'Return from Meditación IA',
      action: { action: 'click', target: { role: 'button', text: '← Centro' } },
      expectation: { text: 'Centro de Mando' }
    },
    {
      id: 'M-capabilities',
      intent: 'Enter Centro de capacidades',
      action: { action: 'click', target: { role: 'button', text: 'Capacidades' } },
      expectation: { text: 'Centro de capacidades' }
    },
    {
      id: 'M-capabilities-cache',
      intent: 'Verify immediate capabilities data/cache surface',
      action: { action: 'wait', value: { ms: 500 } },
      expectation: { text: 'modelos disponibles' }
    },
    {
      id: 'M-capabilities-refresh',
      intent: 'Allow background refresh and re-observe capabilities',
      action: { action: 'wait', value: { ms: 1500 } },
      expectation: { text: 'Actualizado' }
    },
    {
      id: 'M-back',
      intent: 'Return from Centro de capacidades',
      action: { action: 'click', target: { role: 'button', text: '← Centro' } },
      expectation: { text: 'Centro de Mando' }
    },
    {
      id: 'N-repeat-meditation',
      intent: 'Repeat navigation to Meditación IA',
      action: { action: 'click', target: { role: 'button', text: 'Meditación IA' } },
      expectation: { text: 'MEDITACIÓN IA' }
    },
    {
      id: 'N-repeat-meditation-back',
      intent: 'Return after repeated navigation',
      action: { action: 'click', target: { role: 'button', text: '← Centro' } },
      expectation: { text: 'Centro de Mando' }
    },
    {
      id: 'O-signout',
      intent: 'Exit the real session',
      action: { action: 'click', target: { role: 'button', text: 'Salir' } },
      expectation: { present: loginFields }
    },
    {
      id: 'O2-email',
      intent: 'Re-enter after sign-out through secure credential reference',
      action: {
        action: 'type',
        target: { role: 'textbox', label: 'Correo' },
        metadata: { credential_ref: secretRefs.email }
      }
    },
    {
      id: 'O3-password',
      intent: 'Re-enter password after sign-out through secure credential reference',
      action: {
        action: 'type',
        target: { role: 'textbox', label: 'Contraseña' },
        metadata: { credential_ref: secretRefs.password }
      }
    },
    {
      id: 'O4-relogin',
      intent: 'Log back into the real PWA',
      action: { action: 'click', target: { role: 'button', text: 'ENTRAR EN ARIA' } },
      expectation: { text: 'Centro de Mando' }
    }
  ]);
}

function manualRwhtAndroidV1Gates() {
  return Object.freeze([
    {
      id: 'P-mobile-degraded',
      status: 'BLOCKED',
      reason: MOBILE_NETWORK_GATE,
      description: 'Requires physical degraded mobile connectivity; no safe traffic-shaping control is currently exposed by the registered Android device.'
    },
    {
      id: 'Q-recovery-failure',
      status: 'BLOCKED',
      reason: RECOVERY_GATE,
      description: 'Requires a real transient failure on the Android UI path and successful runtime recovery. Backend/mock recovery is not accepted as the physical gate.'
    }
  ]);
}

async function executeRwhtAndroidV1({
  runtime,
  mission_id = 'rwht-android-v1-' + crypto.randomUUID(),
  plan,
  persistEvidence
} = {}) {
  if (!runtime || typeof runtime.executeMission !== 'function') throw new TypeError('runtime_required');
  if (!Array.isArray(plan) || !plan.length) throw new TypeError('plan_required');

  const evidence = [];
  let overall = 'PASS';

  for (const step of plan) {
    const started = Date.now();
    let result;
    try {
      result = await runtime.executeMission({
        mission_id,
        intent: step.intent,
        target: step.action.action === 'navigate'
          ? step.action
          : { ...(step.action.target || {}), action: step.action.action, text: step.action.text, value: step.action.value, metadata: step.action.metadata, expectation: step.expectation },
        risk: step.action.risk || 'read',
        expectation: step.expectation,
        recovery: true
      });
    } catch (error) {
      result = { status: 'failed', reason: error instanceof Error ? error.message : 'rwht_step_exception' };
    }

    const status = result.status === 'succeeded'
      ? 'PASS'
      : result.status === 'blocked' && String(result.reason || '').toUpperCase().includes('OFFLINE')
        ? 'BLOCKED'
        : 'FAIL';

    const record = {
      step_id: step.id,
      intent: step.intent,
      status,
      duration_ms: Date.now() - started,
      reason: result.reason || null,
      result_status: result.status || null,
      evidence_hash: result?.ui?.metadata?.evidence_hash || null,
      ui_version: result?.ui?.version || null
    };

    evidence.push(record);
    if (typeof persistEvidence === 'function') {
      await persistEvidence(record);
    }

    if (status === 'FAIL') {
      overall = 'FAIL';
      break;
    }
  }

  return Object.freeze({
    mission_id,
    device_id: DEVICE_ID,
    overall,
    evidence,
    manual_gates: manualRwhtAndroidV1Gates()
  });
}

function classifyConnectivity({ observeResult, actionResult } = {}) {
  if (observeResult?.reason === 'device_offline' || actionResult?.reason === 'device_offline') {
    return { status: 'BLOCKED', reason: 'BLOCKED_DEVICE_OFFLINE' };
  }
  if (observeResult?.status === 'failed' || actionResult?.status === 'failed') {
    return {
      status: 'FAIL',
      reason: observeResult?.reason || actionResult?.reason || 'device_or_bridge_failure'
    };
  }
  return { status: 'UNKNOWN', reason: 'not_measured' };
}

module.exports = Object.freeze({
  DEVICE_ID,
  DEFAULT_PWA_URL,
  MOBILE_NETWORK_GATE,
  RECOVERY_GATE,
  buildRwhtAndroidV1Plan,
  manualRwhtAndroidV1Gates,
  executeRwhtAndroidV1,
  classifyConnectivity
});
