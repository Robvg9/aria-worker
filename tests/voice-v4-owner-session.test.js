'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

(async () => {
  const {
    SESSION_VERSION, canonicalSessionPayload, encodeBase64Url, createOwnerSessionVerifier
  } = await import('../supabase/functions/_shared/voice-owner-session-verifier.mjs');
  const cryptoProvider = webcrypto;
  const keyPair = await cryptoProvider.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const rawPublicKey = new Uint8Array(await cryptoProvider.subtle.exportKey('raw', keyPair.publicKey));
  const publicKey = encodeBase64Url(rawPublicKey);
  const now = 1793644447000;
  const consumed = new Set();
  const calls = { key: [], policy: [], nonce: [] };

  const makePayload = (overrides = {}) => ({
    version: SESSION_VERSION,
    owner_id: 'owner-12345678',
    device_id: 'device-robvg',
    session_id: 'session-device-0001',
    request_id: 'req-voice-0001',
    activation_id: 'activation-0000001',
    nonce: 'nonce-abcdefghijklmnopqrstuv',
    issued_at: now - 1000,
    expires_at: now + 20000,
    speaker_verified: true,
    speaker_model_id: 'local-speaker-v1',
    speaker_score: 0.94,
    ...overrides
  });

  async function signedSession(payload) {
    const bytes = new TextEncoder().encode(canonicalSessionPayload(payload));
    const signature = await cryptoProvider.subtle.sign(
      { name: 'Ed25519' },
      keyPair.privateKey,
      bytes
    );
    return { payload, signature: encodeBase64Url(new Uint8Array(signature)) };
  }

  function createVerifier(overrides = {}) {
    return createOwnerSessionVerifier({
      cryptoProvider,
      now: () => now,
      resolveTrustedDeviceKey: async deviceId => {
        calls.key.push(deviceId);
        return {
          device_id: deviceId,
          owner_id: 'owner-12345678',
          security: 'trusted',
          health: 'healthy',
          enabled: true,
          public_key: publicKey
        };
      },
      resolveSpeakerPolicy: async input => {
        calls.policy.push(input);
        return { enabled: true, modelId: 'local-speaker-v1', minimumScore: 0.86 };
      },
      nonceStore: {
        consume: async input => {
          calls.nonce.push(input);
          if (consumed.has(input.nonce)) return false;
          consumed.add(input.nonce);
          return true;
        }
      },
      ...overrides
    });
  }

  const verify = createVerifier();
  const validSession = await signedSession(makePayload());
  const valid = await verify(validSession, {
    expectedOwnerId: 'owner-12345678',
    requireSpeaker: true,
    requestId: 'req-voice-0001',
    expiresAt: now + 20000,
    deviceId: 'device-robvg',
    operation: 'display.brightness.set'
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.ownerId, 'owner-12345678');
  assert.equal(valid.deviceId, 'device-robvg');
  assert.equal(valid.speakerVerified, true);
  assert.equal(valid.activationId, 'activation-0000001');
  assert.equal(calls.key.length, 1);
  assert.equal(calls.policy.length, 1);
  assert.equal(calls.nonce.length, 1);

  const replay = await verify(validSession, {
    requireSpeaker: true,
    requestId: 'req-voice-0001',
    expiresAt: now + 20000,
    deviceId: 'device-robvg'
  });
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, 'owner_session_replayed');

  const wrongAuthenticatedOwner = await verify(await signedSession(makePayload({
    nonce: 'nonce-wrong-owner-0000000001'
  })), { expectedOwnerId: 'another-owner-123' });
  assert.equal(wrongAuthenticatedOwner.reason, 'session_owner_mismatch');

  const differentRequest = await verify(await signedSession(makePayload({
    nonce: 'nonce-different-request-000001'
  })), { requireSpeaker: true, requestId: 'req-voice-0002' });
  assert.equal(differentRequest.reason, 'session_request_mismatch');

  const differentDevice = await verify(await signedSession(makePayload({
    nonce: 'nonce-different-device-000001'
  })), { requireSpeaker: true, deviceId: 'device-lacueva' });
  assert.equal(differentDevice.reason, 'session_device_mismatch');

  const expiredVerify = createVerifier({ now: () => now + 30000 });
  const expired = await expiredVerify(await signedSession(makePayload({
    nonce: 'nonce-expired-session-000001',
    expires_at: now + 10000
  })), { requireSpeaker: true });
  assert.equal(expired.reason, 'session_expired');

  const tooLongVerify = createVerifier({ maxTtlMs: 30000 });
  const tooLong = await tooLongVerify(await signedSession(makePayload({
    nonce: 'nonce-too-long-session-00001',
    expires_at: now + 60000
  })), { requireSpeaker: true });
  assert.equal(tooLong.reason, 'session_ttl_exceeded');

  const tamperedPayload = makePayload({ nonce: 'nonce-tampered-session-000001' });
  const tampered = await signedSession(tamperedPayload);
  tampered.payload.speaker_score = 0.99;
  const badSignature = await verify(tampered, { requireSpeaker: true });
  assert.equal(badSignature.reason, 'owner_session_signature_invalid');

  const lowSpeaker = await verify(await signedSession(makePayload({
    nonce: 'nonce-low-speaker-score-00001',
    speaker_score: 0.50
  })), { requireSpeaker: true });
  assert.equal(lowSpeaker.reason, 'speaker_policy_rejected');

  const noSpeaker = await verify(await signedSession(makePayload({
    nonce: 'nonce-no-speaker-00000000001',
    speaker_verified: false,
    speaker_model_id: null,
    speaker_score: null
  })), { requireSpeaker: true });
  assert.equal(noSpeaker.reason, 'speaker_verification_required');

  const readSession = await verify(await signedSession(makePayload({
    nonce: 'nonce-read-session-0000000001',
    speaker_verified: false,
    speaker_model_id: null,
    speaker_score: null
  })), { requireSpeaker: false, requestId: 'req-voice-0001' });
  assert.equal(readSession.valid, true);
  assert.equal(readSession.speakerVerified, false);

  const untrustedVerify = createVerifier({
    resolveTrustedDeviceKey: async deviceId => ({
      device_id: deviceId,
      owner_id: 'owner-12345678',
      security: 'restricted',
      health: 'healthy',
      enabled: true,
      public_key: publicKey
    })
  });
  const untrusted = await untrustedVerify(await signedSession(makePayload({
    nonce: 'nonce-untrusted-device-000001'
  })), { requireSpeaker: true });
  assert.equal(untrusted.reason, 'owner_session_device_not_trusted');

  const nonceStoreFailure = createVerifier({
    nonceStore: { consume: async () => { throw new Error('database unavailable'); } }
  });
  const nonceUnavailable = await nonceStoreFailure(await signedSession(makePayload({
    nonce: 'nonce-store-failure-000000001'
  })), { requireSpeaker: true });
  assert.equal(nonceUnavailable.reason, 'owner_session_nonce_store_unavailable');

  console.log('ARIA VOICE V4 SIGNED OWNER SESSION + ANTI-REPLAY CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
