'use strict';

const assert = require('node:assert/strict');
const { createVoiceCommandRouter, LANES } = require('../voice-v4/command-router');

function fixture(overrides = {}) {
  const calls = { read: [], action: [], claim: [], auth: [], capability: [] };
  const claimed = new Set();
  let clock = 1793644447000;
  const router = createVoiceCommandRouter({
    now: () => clock,
    verifyOwnerSession: async (session, options) => {
      calls.auth.push({ session, options });
      if (session?.valid !== true) return { valid: false };
      return { valid: true, ownerId: 'owner-1', speakerVerified: session.speakerVerified === true };
    },
    authorizeCapability: async input => {
      calls.capability.push(input);
      return { allowed: true };
    },
    resolveDevice: async deviceId => ({
      device_id: deviceId,
      health: 'healthy',
      security: 'trusted',
      capabilities: ['device.telemetry', 'display.brightness.write', 'app.open', 'browser.open_url']
    }),
    readStatus: async input => {
      calls.read.push(input);
      return { status: 'ok', state: 'online', temperature: 42, token: 'MUST_NOT_ESCAPE' };
    },
    executeAction: async input => {
      calls.action.push(input);
      return { ok: true, brightness: input.params.brightness, status: 'ok', shell: 'MUST_NOT_ESCAPE' };
    },
    idempotencyStore: {
      claim: async input => {
        calls.claim.push(input);
        if (claimed.has(input.key)) return false;
        claimed.add(input.key);
        return true;
      }
    },
    isMissionExecutionPaused: () => true,
    allowedApps: ['chrome', 'com.google.android.youtube'],
    allowedUrlHosts: ['youtube.com', 'github.com'],
    ...overrides
  });
  return {
    router, calls,
    setNow(value) { clock = value; }
  };
}

function request(overrides = {}) {
  return {
    request_id: 'req-voice-0001',
    idempotency_key: 'voice-idem-key-000001',
    expires_at: 1793644470000,
    lane: LANES.DEVICE_ACTION,
    operation: 'display.brightness.set',
    device_id: 'device-robvg',
    params: { brightness: 100 },
    owner_session: { valid: true, speakerVerified: true },
    source: 'voice',
    ...overrides
  };
}

(async () => {
  const fx = fixture();
  const allowed = await fx.router.route(request());
  assert.equal(allowed.status, 'succeeded');
  assert.equal(allowed.executed, true);
  assert.equal(allowed.result.brightness, 100);
  assert.equal(Object.hasOwn(allowed.result, 'shell'), false, 'adapter command text must never escape');
  assert.equal(fx.calls.action.length, 1);
  assert.equal(fx.calls.claim.length, 1);
  assert.equal(fx.calls.auth[0].options.requireSpeaker, true);

  const duplicate = await fx.router.route(request({ request_id: 'req-voice-0002' }));
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(fx.calls.action.length, 1, 'idempotency must prevent a second device action');
  const crossDeviceDuplicate = await fx.router.route(request({
    request_id: 'req-voice-0003',
    device_id: 'device-lacueva'
  }));
  assert.equal(crossDeviceDuplicate.status, 'duplicate', 'shared idempotency must prevent the same voice command on a second device');
  assert.equal(fx.calls.action.length, 1);

  const readFx = fixture();
  const read = await readFx.router.route(request({
    lane: LANES.READ,
    operation: 'device.status',
    params: {},
    owner_session: { valid: true, speakerVerified: false }
  }));
  assert.equal(read.status, 'succeeded');
  assert.equal(read.executed, false);
  assert.equal(read.result.state, 'online');
  assert.equal(Object.hasOwn(read.result, 'token'), false, 'sensitive adapter fields must not escape');
  assert.equal(readFx.calls.read.length, 1);
  assert.equal(readFx.calls.auth[0].options.requireSpeaker, false);

  const globalReadFx = fixture();
  const globalRead = await globalReadFx.router.route(request({
    lane: LANES.READ,
    operation: 'aria.status',
    device_id: undefined,
    params: {},
    owner_session: { valid: true, speakerVerified: false }
  }));
  assert.equal(globalRead.status, 'succeeded');
  assert.equal(globalRead.executed, false);
  assert.equal(globalReadFx.calls.read[0].device, null, 'global ARIA status must not guess a device');
  assert.equal(globalReadFx.calls.capability[0].deviceId, null);

  const blockedMission = await fx.router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-001',
    params: {}
  }));
  assert.equal(blockedMission.status, 'blocked');
  assert.equal(blockedMission.reason, 'mission_execution_paused');
  assert.equal(fx.calls.action.length, 1, 'mission lane must never reach the device action executor');

  const noSpeakerFx = fixture();
  const noSpeaker = await noSpeakerFx.router.route(request({
    owner_session: { valid: true, speakerVerified: false }
  }));
  assert.equal(noSpeaker.reason, 'owner_speaker_verification_required');
  assert.equal(noSpeakerFx.calls.action.length, 0);

  const noTargetFx = fixture();
  const noTarget = await noTargetFx.router.route(request({ device_id: undefined }));
  assert.equal(noTarget.reason, 'explicit_device_target_required');
  assert.equal(noTargetFx.calls.action.length, 0);

  const badBrightness = await fixture().router.route(request({ params: { brightness: 101 } }));
  assert.equal(badBrightness.reason, 'device_action_params_invalid');

  const badApp = await fixture().router.route(request({
    operation: 'app.open',
    params: { app_id: 'powershell' }
  }));
  assert.equal(badApp.reason, 'device_action_params_invalid');

  const validAppFx = fixture();
  const validApp = await validAppFx.router.route(request({
    operation: 'app.open',
    params: { app_id: 'chrome' }
  }));
  assert.equal(validApp.status, 'succeeded');

  const goodUrl = await fixture().router.route(request({
    operation: 'browser.open_url',
    params: { url: 'https://github.com/Robvg9/aria-worker' }
  }));
  assert.equal(goodUrl.status, 'succeeded');

  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://evil.example', 'https://user:pass@github.com']) {
    const result = await fixture().router.route(request({
      operation: 'browser.open_url',
      params: { url }
    }));
    assert.equal(result.reason, 'device_action_params_invalid', 'unsafe URL must be blocked: ' + url);
  }

  const messageFx = fixture();
  const message = await messageFx.router.route(request({
    operation: 'message.send',
    params: { recipient_id: 'contact-mom', body: 'Te quiero.' }
  }));
  assert.equal(message.status, 'confirmation_required');
  assert.equal(message.executed, false);
  assert.equal(message.confirmation_channel, 'visible_authenticated_ui');
  assert.equal(messageFx.calls.action.length, 0, 'voice biometrics alone must never send a message');

  const missionContext = await fixture().router.route(request({ mission_id: 'mission-not-allowed' }));
  assert.equal(missionContext.reason, 'mission_context_forbidden_on_direct_lane');

  const rawCommand = await fixture().router.route(request({ command: 'powershell -c whoami' }));
  assert.equal(rawCommand.reason, 'raw_command_or_audio_forbidden');

  const tooLongTtl = await fixture().router.route(request({ expires_at: 1793644570000 }));
  assert.equal(tooLongTtl.reason, 'request_expired_or_ttl_invalid');

  const expiredFx = fixture();
  expiredFx.setNow(1793644500000);
  const expired = await expiredFx.router.route(request());
  assert.equal(expired.reason, 'request_expired_or_ttl_invalid');

  const untrustedDevice = await fixture({
    resolveDevice: async deviceId => ({
      device_id: deviceId, health: 'degraded', security: 'restricted',
      capabilities: ['display.brightness.write']
    })
  }).router.route(request());
  assert.equal(untrustedDevice.reason, 'device_not_trusted_and_healthy');

  const missingCapability = await fixture({
    resolveDevice: async deviceId => ({
      device_id: deviceId, health: 'healthy', security: 'trusted', capabilities: ['device.telemetry']
    })
  }).router.route(request());
  assert.equal(missingCapability.reason, 'device_capability_missing');

  const authzDenied = await fixture({
    authorizeCapability: async () => ({ allowed: false, reason: 'capability_denied' })
  }).router.route(request());
  assert.equal(authzDenied.reason, 'capability_denied');

  const storeUnavailable = await fixture({
    idempotencyStore: { claim: async () => { throw new Error('db offline'); } }
  }).router.route(request());
  assert.equal(storeUnavailable.reason, 'idempotency_store_unavailable');

  const missionUnpaused = await fixture({
    isMissionExecutionPaused: () => false
  }).router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-002',
    params: {}
  }));
  assert.equal(missionUnpaused.status, 'confirmation_required');
  assert.equal(missionUnpaused.executed, false);

  console.log('ARIA VOICE V4 COMMAND ROUTER POLICY CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
