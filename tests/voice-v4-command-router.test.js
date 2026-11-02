'use strict';

const assert = require('node:assert/strict');

let createVoiceCommandRouter;
let LANES;

function fixture(overrides = {}) {
  const calls = { read: [], action: [], claim: [], auth: [], capability: [] };
  const claimed = new Set();
  let clock = 1793644447000;
  const router = createVoiceCommandRouter({
    authenticatedOwnerId: 'owner-123',
    now: () => clock,
    verifyOwnerSession: async (session, options) => {
      calls.auth.push({ session, options });
      if (session?.valid !== true) return { valid: false };
      return { valid: true, ownerId: 'owner-123', speakerVerified: session.speakerVerified === true };
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
      return { ok: true, status: 'queued', command_id: '123e4567-e89b-42d3-a456-426614174000' };
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
    source_device_id: 'device-android',
    params: { brightness: 100 },
    owner_session: { valid: true, speakerVerified: true },
    source: 'voice',
    ...overrides
  };
}

(async () => {
  ({ createVoiceCommandRouter, LANES } = await import('../supabase/functions/_shared/voice-command-router.mjs'));
  const fx = fixture();
  const allowed = await fx.router.route(request());
  assert.equal(allowed.status, 'queued', 'the API must not claim execution before a target agent confirms it');
  assert.equal(allowed.executed, false);
  assert.equal(allowed.command_id, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(allowed.device_id, 'device-robvg');
  assert.equal(allowed.operation, 'display.brightness.set');
  assert.equal(Object.hasOwn(allowed, 'result'), false);
  assert.equal(fx.calls.action.length, 1);
  assert.equal(fx.calls.claim.length, 1);
  assert.equal(fx.calls.auth[0].options.requireSpeaker, true);
  assert.equal(fx.calls.auth[0].options.expectedOwnerId, 'owner-123');
  assert.equal(fx.calls.auth[0].options.deviceId, 'device-android');
  assert.equal(fx.calls.action[0].sourceDeviceId, 'device-android', 'signature source and action target must remain separate');

  const queuedDuplicate = await fixture({
    executeAction: async () => ({ ok: true, status: 'duplicate' })
  }).router.route(request());
  assert.equal(queuedDuplicate.status, 'duplicate');
  assert.equal(queuedDuplicate.executed, false);

  const invalidQueueAck = await fixture({
    executeAction: async () => ({ ok: true, status: 'queued', command_id: 'not-a-uuid' })
  }).router.route(request());
  assert.equal(invalidQueueAck.status, 'failed');
  assert.equal(invalidQueueAck.reason, 'device_queue_ack_invalid');
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
  const invalidGlobalTarget = await fixture().router.route(request({
    lane: LANES.READ,
    operation: 'aria.status',
    device_id: 'device-robvg',
    params: {},
    owner_session: { valid: true, speakerVerified: false }
  }));
  assert.equal(invalidGlobalTarget.reason, 'global_status_must_not_target_device');

  const blockedMission = await fx.router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-001',
    params: {}
  }));
  assert.equal(blockedMission.status, 'blocked');
  assert.equal(blockedMission.reason, 'mission_execution_paused');
  assert.equal(fx.calls.action.length, 1, 'mission lane must never reach the device action executor');

  const missionMissingId = await fx.router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: undefined,
    params: {}
  }));
  assert.equal(missionMissingId.reason, 'mission_id_required');
  const missionWrongOperation = await fx.router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'shell.execute',
    mission_id: 'mission-voice-005',
    params: {}
  }));
  assert.equal(missionWrongOperation.reason, 'mission_operation_not_allowed');
  const missionJobInjection = await fx.router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-006',
    job_id: 'job-injected-001',
    params: {}
  }));
  assert.equal(missionJobInjection.reason, 'mission_job_context_forbidden');

  const noSpeakerFx = fixture();
  const noSpeaker = await noSpeakerFx.router.route(request({
    owner_session: { valid: true, speakerVerified: false }
  }));
  assert.equal(noSpeaker.reason, 'owner_speaker_verification_required');
  assert.equal(noSpeakerFx.calls.action.length, 0);

  const noTargetFx = fixture();
  const noSource = await noTargetFx.router.route(request({ source_device_id: undefined }));
  assert.equal(noSource.reason, 'source_device_id_required');

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

  const safeAdapterResultFx = fixture({
    executeAction: async () => ({
      ok: true,
      url: 'https://github.com/Robvg9/aria-worker?access_token=SECRET#session',
      app_id: 'chrome',
      opened: true
    })
  });
  const safeAdapterResult = await safeAdapterResultFx.router.route(request({
    operation: 'browser.open_url',
    params: { url: 'https://github.com/Robvg9/aria-worker' }
  }));
  assert.equal(safeAdapterResult.status, 'succeeded');
  assert.equal(safeAdapterResult.result.url, 'https://github.com/Robvg9/aria-worker');
  assert.equal(safeAdapterResult.result.app_id, 'chrome');
  assert.equal(JSON.stringify(safeAdapterResult).includes('SECRET'), false,
    'adapter URLs must never reflect query credentials or fragments');

  const unsafeAdapterResultFx = fixture({
    executeAction: async () => ({
      ok: true,
      url: 'https://evil.example/redirect?token=SECRET',
      app_id: 'powershell',
      opened: true
    })
  });
  const unsafeAdapterResult = await unsafeAdapterResultFx.router.route(request({
    operation: 'browser.open_url',
    params: { url: 'https://github.com/Robvg9/aria-worker' }
  }));
  assert.equal(unsafeAdapterResult.status, 'succeeded');
  assert.equal(Object.hasOwn(unsafeAdapterResult.result, 'url'), false,
    'unapproved adapter URLs must be omitted');
  assert.equal(Object.hasOwn(unsafeAdapterResult.result, 'app_id'), false,
    'unapproved adapter app IDs must be omitted');

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
  const messageNoSpeaker = await fixture().router.route(request({
    operation: 'message.send',
    owner_session: { valid: true, speakerVerified: false },
    params: { recipient_id: 'contact-mom', body: 'Te quiero.' }
  }));
  assert.equal(messageNoSpeaker.reason, 'owner_speaker_verification_required');

  const unknownAction = await fixture().router.route(request({
    operation: 'shell.execute',
    params: { command: 'whoami' }
  }));
  assert.equal(unknownAction.reason, 'device_action_not_allowlisted');

  const authUnavailable = await fixture({
    verifyOwnerSession: async () => { throw new Error('native verifier unavailable'); }
  }).router.route(request());
  assert.equal(authUnavailable.reason, 'owner_session_verification_failed');

  const pauseUnavailable = await fixture({
    isMissionExecutionPaused: () => { throw new Error('mission state unavailable'); }
  }).router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-003',
    params: {}
  }));
  assert.equal(pauseUnavailable.reason, 'mission_pause_state_unavailable');
  assert.equal(pauseUnavailable.executed, false);

  const authorizationUnavailable = await fixture({
    authorizeCapability: async () => { throw new Error('authorization unavailable'); }
  }).router.route(request());
  assert.equal(authorizationUnavailable.reason, 'capability_authorization_unavailable');

  const deviceLookupUnavailable = await fixture({
    resolveDevice: async () => { throw new Error('registry unavailable'); }
  }).router.route(request());
  assert.equal(deviceLookupUnavailable.reason, 'device_lookup_failed');


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

  const missionUnpausedFx = fixture({
    isMissionExecutionPaused: () => false
  });
  const missionUnpaused = await missionUnpausedFx.router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-002',
    params: {}
  }));
  assert.equal(missionUnpaused.status, 'confirmation_required');
  assert.equal(missionUnpaused.executed, false);
  assert.equal(missionUnpausedFx.calls.auth[0].options.requireSpeaker, true);

  const missionNoSpeaker = await fixture({
    isMissionExecutionPaused: () => false
  }).router.route(request({
    lane: LANES.MISSION_EXECUTE,
    operation: 'mission.start',
    mission_id: 'mission-voice-004',
    params: {},
    owner_session: { valid: true, speakerVerified: false }
  }));
  assert.equal(missionNoSpeaker.reason, 'owner_speaker_verification_required');

  const clockUnavailable = await fixture({
    now: () => { throw new Error('clock failure'); }
  }).router.route(request());
  assert.equal(clockUnavailable.reason, 'clock_unavailable');

  console.log('ARIA VOICE V4 COMMAND ROUTER POLICY CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
