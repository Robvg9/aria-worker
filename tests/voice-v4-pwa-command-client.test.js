'use strict';

const assert = require('node:assert/strict');
const {
  parseExplicitVoiceAction,
  dispatchVoiceAction,
  getVoiceCommandStatus
} = await import('../pwa/src/voiceCommandClient.js');

const devices = [
  { device_id: 'robvg9-pc-001', display_name: 'RobVG', aliases: ['PC principal'] },
  { device_id: 'lacueva-pc-001', display_name: 'LaCueva', aliases: ['portátil'] }
];

assert.deepEqual(
  parseExplicitVoiceAction('Pon el brillo al 80% en RobVG', devices),
  {
    lane: 'device.action',
    operation: 'display.brightness.set',
    device_id: 'robvg9-pc-001',
    params: { brightness: 80 }
  }
);
assert.deepEqual(
  parseExplicitVoiceAction('Estado de ARIA', devices),
  { lane: 'read', operation: 'aria.status', params: {} }
);
assert.deepEqual(
  parseExplicitVoiceAction('estado de LaCueva', devices),
  {
    lane: 'read',
    operation: 'device.status',
    device_id: 'lacueva-pc-001',
    params: {}
  }
);
assert.equal(parseExplicitVoiceAction('abre Chrome en RobVG', devices).operation, 'app.open');
assert.equal(parseExplicitVoiceAction('abre https://github.com/Robvg9/aria-worker en RobVG', devices).operation, 'browser.open_url');
assert.equal(parseExplicitVoiceAction('abre javascript:alert(1) en RobVG', devices), null,
  'unrecognized unsafe URL phrasing must never become an action');
assert.equal(parseExplicitVoiceAction('cuéntame cómo está el mundo', devices), null,
  'normal conversation must remain on the conversation route');
assert.equal(
  parseExplicitVoiceAction('pon el brillo al 150% en RobVG', devices).error,
  'voice_brightness_value_invalid'
);
assert.equal(
  parseExplicitVoiceAction('estado de equipo desconocido', devices).error,
  'voice_device_target_not_found'
);

await assert.rejects(
  () => dispatchVoiceAction({
    api: async () => ({ ok: true }),
    bridge: null,
    intent: parseExplicitVoiceAction('Estado de ARIA', devices),
    ownerId: '123e4567-e89b-42d3-a456-426614174000'
  }),
  /voice_v4_native_signer_unavailable/
);

const ownerId = '123e4567-e89b-42d3-a456-426614174000';
const fixedRequestId = '123e4567-e89b-42d3-a456-426614174001';
const fixedIdempotency = '123e4567-e89b-42d3-a456-426614174002';
let signedInput = null;
let sentRequest = null;
const queued = await dispatchVoiceAction({
  api: async (path, init) => {
    assert.equal(path, '/voice/commands');
    assert.equal(init.method, 'POST');
    sentRequest = JSON.parse(init.body);
    return {
      ok: true,
      command: {
        status: 'queued',
        command_id: '123e4567-e89b-42d3-a456-426614174003',
        device_id: 'robvg9-pc-001',
        operation: 'display.brightness.set'
      }
    };
  },
  bridge: {
    async createOwnerSession(input) {
      signedInput = input;
      return {
        source_device_id: 'android-phone-001',
        owner_session: {
          payload: {
            owner_id: ownerId,
            device_id: 'android-phone-001',
            request_id: input.request_id,
            expires_at: input.expires_at,
            speaker_verified: true,
            speaker_model_id: 'owner-cuban-es-approved',
            speaker_score: 0.97
          },
          signature: 'A'.repeat(86)
        }
      };
    }
  },
  intent: parseExplicitVoiceAction('Pon el brillo al 80% en RobVG', devices),
  ownerId,
  now: () => 1793644447000,
  randomUUID: (() => {
    const values = [fixedRequestId, fixedIdempotency];
    return () => values.shift();
  })()
});
assert.equal(queued.command.status, 'queued');
assert.equal(signedInput.owner_id, ownerId);
assert.equal(signedInput.operation, 'display.brightness.set');
assert.equal(signedInput.target_device_id, 'robvg9-pc-001');
assert.equal(sentRequest.request_id, fixedRequestId);
assert.equal(sentRequest.idempotency_key, fixedIdempotency);
assert.equal(sentRequest.expires_at, 1793644467000);
assert.equal(sentRequest.source_device_id, 'android-phone-001');
assert.equal(sentRequest.device_id, 'robvg9-pc-001');
assert.deepEqual(sentRequest.params, { brightness: 80 });
assert.equal(sentRequest.source, 'voice');
assert.equal(sentRequest.owner_session.signature, 'A'.repeat(86));

await assert.rejects(
  () => dispatchVoiceAction({
    api: async () => { throw new Error('must_not_dispatch'); },
    bridge: {
      async createOwnerSession(input) {
        return {
          source_device_id: 'android-phone-001',
          owner_session: {
            payload: {
              owner_id: ownerId,
              device_id: 'android-phone-001',
              request_id: input.request_id,
              expires_at: input.expires_at,
              speaker_verified: false,
              speaker_model_id: null,
              speaker_score: null
            },
            signature: 'A'.repeat(86)
          }
        };
      }
    },
    intent: parseExplicitVoiceAction('Pon el brillo al 50% en RobVG', devices),
    ownerId,
    randomUUID: (() => {
      const values = [fixedRequestId, fixedIdempotency];
      return () => values.shift();
    })()
  }),
  /voice_v4_speaker_verification_unavailable/
);

const commandId = '123e4567-e89b-42d3-a456-426614174003';
let statusPath = '';
const status = await getVoiceCommandStatus(async path => {
  statusPath = path;
  return {
    ok: true,
    terminal: true,
    command: {
      command_id: commandId,
      device_id: 'robvg9-pc-001',
      operation: 'display.brightness.set',
      status: 'succeeded',
      result: {
        ok: true,
        brightness: 80,
        secret: 'DO_NOT_SHOW',
        nested: { token: 'DO_NOT_SHOW' }
      }
    }
  };
}, commandId);
assert.equal(statusPath, '/voice/commands/' + commandId);
assert.equal(status.status, 'succeeded');
assert.equal(status.terminal, true);
assert.deepEqual(status.result, { ok: true, brightness: 80 });
assert.equal(JSON.stringify(status).includes('DO_NOT_SHOW'), false);

await assert.rejects(
  () => getVoiceCommandStatus(async () => { throw new Error('must_not_fetch'); }, 'not-a-uuid'),
  /voice_command_status_id_invalid/
);
await assert.rejects(
  () => getVoiceCommandStatus(async () => ({
    ok: true,
    terminal: true,
    command: { command_id: commandId, status: 'succeeded' }
  }), commandId),
  /voice_command_status_response_invalid/
);

console.log('VOICE V4 PWA SIGNED COMMAND + OWNER STATUS CLIENT: PASS');
