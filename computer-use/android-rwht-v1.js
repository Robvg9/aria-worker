'use strict';

const DEFAULT_PWA_URL = 'https://aria.robvg9.workers.dev/pwa/';
const DEVICE_ID = 'android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092';

function buildRwhtAndroidV1Plan({ pwaUrl = DEFAULT_PWA_URL, expectedBuild = null, secretRefs } = {}) {
  if (!secretRefs?.email || !secretRefs?.password) {
    throw new Error('rwht_secret_refs_required');
  }

  const buildExpectation = expectedBuild ? [{ role: 'text', text: expectedBuild }] : [];
  const loginFields = [
    { role: 'textbox', label: 'Correo' },
    { role: 'textbox', label: 'Contraseña' }
  ];

  return Object.freeze([
    { id: 'A-open-pwa', intent: 'Open canonical ARIA PWA', action: {
      action: 'navigate',
      value: { url: pwaUrl }
    }, expectation: { present: loginFields, text: expectedBuild || undefined } },

    { id: 'B-settle-and-build', intent: 'Wait for login UI to settle and verify the expected build',
      action: { action: 'wait', value: { ms: 1500 } },
      expectation: { present: loginFields, ...(buildExpectation.length ? { present: loginFields, text: expectedBuild } : {}) } },

    { id: 'D1-email', intent: 'Enter email via governed credential reference',
      action: { action: 'type', target: { role: 'textbox', label: 'Correo' },
        metadata: { credential_ref: secretRefs.email } },
      expectation: { present: [{ role: 'textbox', label: 'Correo' }] } },

    { id: 'D2-password', intent: 'Enter password via governed credential reference',
      action: { action: 'type', target: { role: 'textbox', label: 'Contraseña' },
        metadata: { credential_ref: secretRefs.password } },
      expectation: { present: [{ role: 'textbox', label: 'Contraseña' }] } },

    { id: 'D3-login', intent: 'Press login control',
      action: { action: 'click', target: { role: 'button', text: 'ENTRAR EN ARIA' } },
      expectation: { present: [
        { role: 'button', text: 'Nueva misión' },
        { role: 'button', text: 'Meditación IA' },
        { role: 'button', text: 'Capacidades' }
      ], text: 'Centro de Mando' } },

    { id: 'E-dashboard', intent: 'Verify the real dashboard',
      action: { action: 'wait', value: { ms: 800 } },
      expectation: { present: [
        { role: 'button', text: 'Nueva misión' },
        { role: 'button', text: 'Meditación IA' },
        { role: 'button', text: 'Capacidades' },
        { role: 'button', text: 'Salir' }
      ], text: 'Centro de Mando' } },

    { id: 'F-models', intent: 'Open Modelos disponibles modal',
      action: { action: 'click', target: { role: 'button', text: 'Modelos disponibles' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] } },

    { id: 'F-models-close', intent: 'Close model catalog',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } } },

    { id: 'G-agents', intent: 'Open Agentes disponibles modal',
      action: { action: 'click', target: { role: 'button', text: 'Agentes disponibles' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] } },

    { id: 'G-agents-close', intent: 'Close agent catalog',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } } },

    { id: 'H-devices', intent: 'Open Dispositivos online modal',
      action: { action: 'click', target: { role: 'button', text: 'Dispositivos online' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] } },

    { id: 'H-devices-close', intent: 'Close device catalog',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } } },

    { id: 'I-connections', intent: 'Open Conexiones modal',
      action: { action: 'click', target: { role: 'button', text: 'Conexiones' } },
      expectation: { present: [{ role: 'button', text: 'Cerrar' }] } },

    { id: 'I-connections-close', intent: 'Close connections catalog',
      action: { action: 'click', target: { role: 'button', text: 'Cerrar' } } },

    { id: 'J-conversation-focus', intent: 'Focus direct conversation input',
      action: { action: 'click', target: { role: 'textbox', label: 'Habla con ARIA…' } },
      expectation: { present: [{ role: 'textbox', label: 'Habla con ARIA…' }] } },

    { id: 'K-new-mission', intent: 'Open low-risk mission form',
      action: { action: 'click', target: { role: 'button', text: 'Nueva misión' } },
      expectation: { present: [{ role: 'textbox' }], text: '¿Qué debe hacer ARIA?' } },

    { id: 'K-cancel-mission', intent: 'Cancel mission form without side effects',
      action: { action: 'click', target: { role: 'button', text: 'Cancelar' } },
      expectation: { absent: [{ role: 'text', text: '¿Qué debe hacer ARIA?' }] } },

    { id: 'L-meditation', intent: 'Enter Meditación IA',
      action: { action: 'click', target: { role: 'button', text: 'Meditación IA' } },
      expectation: { present: [{ role: 'button', text: '← Centro' }], text: 'MEDITACIÓN IA' } },

    { id: 'L-back', intent: 'Return to dashboard from Meditación IA',
      action: { action: 'click', target: { role: 'button', text: '← Centro' } },
      expectation: { present: [{ role: 'button', text: 'Nueva misión' }], text: 'Centro de Mando' } },

    { id: 'M-capabilities', intent: 'Enter Capacidades',
      action: { action: 'click', target: { role: 'button', text: 'Capacidades' } },
      expectation: { present: [{ role: 'button', text: '← Centro' }], text: 'Centro de capacidades' } },

    { id: 'M-back', intent: 'Return to dashboard from Capacidades',
      action: { action: 'click', target: { role: 'button', text: '← Centro' } },
      expectation: { present: [{ role: 'button', text: 'Nueva misión' }], text: 'Centro de Mando' } },

    { id: 'N-navigation', intent: 'Exercise repeated dashboard navigation safely',
      action: { action: 'click', target: { role: 'button', text: 'Nueva misión' } },
      expectation: { present: [{ role: 'button', text: 'Cancelar' }] } },

    { id: 'N-navigation-back', intent: 'Close repeated navigation surface',
      action: { action: 'click', target: { role: 'button', text: 'Cancelar' } } },

    { id: 'O-signout', intent: 'Exit session',
      action: { action: 'click', target: { role: 'button', text: 'Salir' } },
      expectation: { present: [
        { role: 'textbox', label: 'Correo' },
        { role: 'textbox', label: 'Contraseña' }
      ] } }
  ]);
}

function classifyConnectivity({ observeResult, actionResult } = {}) {
  if (observeResult?.reason === 'device_offline' || actionResult?.reason === 'device_offline') {
    return { status: 'BLOCKED', reason: 'BLOCKED_DEVICE_OFFLINE' };
  }
  if (observeResult?.status === 'failed' || actionResult?.status === 'failed') {
    return { status: 'FAIL', reason: observeResult?.reason || actionResult?.reason || 'device_or_bridge_failure' };
  }
  return { status: 'UNKNOWN', reason: 'not_measured' };
}

module.exports = Object.freeze({
  DEVICE_ID,
  DEFAULT_PWA_URL,
  buildRwhtAndroidV1Plan,
  classifyConnectivity
});
