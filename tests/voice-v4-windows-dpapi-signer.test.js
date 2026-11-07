'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createWindowsVoiceOwnerKeystore,
  canonicalizeOwnerSessionPayload,
  SESSION_VERSION
} = require('../agents/windows/voice-owner-session-keystore.cjs');

function makePayload(now = Date.now()) {
  return {
    activation_id: 'activation-windows-0001',
    device_id: 'windows-lacueva-780886',
    expires_at: now + 20000,
    issued_at: now,
    nonce: 'nonce-windows-owner-session-0000001',
    owner_id: '123e4567-e89b-42d3-a456-426614174000',
    request_id: 'request-windows-owner-0001',
    session_id: 'session-windows-owner-0001',
    speaker_model_id: null,
    speaker_score: null,
    speaker_verified: false,
    version: SESSION_VERSION
  };
}

function makeTestDpapi() {
  return {
    protect(bytes) { return Buffer.concat([Buffer.from('TEST-DPAPI:'), Buffer.from(bytes).reverse()]); },
    unprotect(bytes) {
      const prefix = Buffer.from('TEST-DPAPI:');
      assert.equal(bytes.subarray(0, prefix.length).toString(), prefix.toString());
      return Buffer.from(bytes.subarray(prefix.length)).reverse();
    }
  };
}

function verifySignature(publicKeyRaw, canonical, signature) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([prefix, publicKeyRaw]), format: 'der', type: 'spki'
  });
  return crypto.verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64url'));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-voice-v4-dpapi-test-'));
  try {
    const store = createWindowsVoiceOwnerKeystore({ platform: 'win32', baseDirectory: root, ownerId: '123e4567-e89b-42d3-a456-426614174000', deviceId: 'windows-lacueva-780886', dpapi: makeTestDpapi() });
    const key = store.getDeviceKey();
    assert.equal(key.algorithm, 'Ed25519');
    assert.equal(key.keyStorage, 'WindowsDPAPI_CurrentUser');
    assert.equal(key.ownerId, '123e4567-e89b-42d3-a456-426614174000');
    assert.equal(key.deviceId, 'windows-lacueva-780886');
    assert.match(key.fingerprintSha256, /^[a-f0-9]{64}$/);

    const pairing = store.getPairingMaterial();
    assert.equal(pairing.ownerId, key.ownerId);
    assert.equal(pairing.deviceId, key.deviceId);
    assert.equal(pairing.publicKeyId, key.keyId);
    assert.equal(pairing.publicKeyEd25519, key.publicKey);
    assert.equal(pairing.publicKeyFingerprintSha256, key.fingerprintSha256);
    assert.equal(pairing.keyStorage, 'WindowsDPAPI_CurrentUser');
    assert.match(pairing.deviceToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(store.getDeviceToken(), pairing.deviceToken, 'device token must remain stable across reads');

    const reloaded = createWindowsVoiceOwnerKeystore({
      platform: 'win32', baseDirectory: root, ownerId: '123e4567-e89b-42d3-a456-426614174000',
      deviceId: 'windows-lacueva-780886', dpapi: makeTestDpapi()
    });
    assert.equal(reloaded.getPairingMaterial().deviceToken, pairing.deviceToken,
      'DPAPI-protected device token must survive keystore reload');

    const stored = fs.readFileSync(store.filePath, 'utf8');
    const storedRecord = JSON.parse(stored);
    assert.equal(stored.includes('BEGIN PRIVATE KEY'), false);
    assert.equal(stored.includes('TEST-DPAPI:'), false);
    assert.equal(stored.includes(pairing.deviceToken), false, 'raw device token must never be persisted');
    assert.match(storedRecord.protected_device_token, /^[A-Za-z0-9+/]+=*$/);

    const canonical = canonicalizeOwnerSessionPayload(makePayload());
    const signed = store.signCanonicalPayload(canonical);
    assert.equal(verifySignature(Buffer.from(key.publicKey, 'base64url'), canonical, signed.signature), true);

    const shuffled = Object.fromEntries(Object.entries(makePayload()).reverse());
    assert.throws(() => store.signCanonicalPayload(JSON.stringify(shuffled)), /not_canonical/);

    const wrongOwner = makePayload();
    wrongOwner.owner_id = '123e4567-e89b-42d3-a456-426614174099';
    assert.throws(() => store.signCanonicalPayload(JSON.stringify(wrongOwner)), /owner_mismatch/);

    const wrongDevice = makePayload();
    wrongDevice.device_id = 'windows-another-device';
    assert.throws(() => store.signCanonicalPayload(JSON.stringify(wrongDevice)), /device_mismatch/);

    const unapprovedSpeaker = makePayload();
    unapprovedSpeaker.speaker_verified = true;
    unapprovedSpeaker.speaker_model_id = 'synthetic-speaker-v1';
    unapprovedSpeaker.speaker_score = 0.99;
    assert.throws(() => store.signCanonicalPayload(JSON.stringify(unapprovedSpeaker)), /speaker_verification_unavailable/);

    const wrongStore = createWindowsVoiceOwnerKeystore({
      platform: 'win32', baseDirectory: root, ownerId: '123e4567-e89b-42d3-a456-426614174000', deviceId: 'windows-other-device', dpapi: makeTestDpapi()
    });
    assert.throws(() => wrongStore.getDeviceKey(), /record_invalid/);

    assert.deepEqual(store.deleteDeviceKey(), { deleted: true });
    assert.deepEqual(store.deleteDeviceKey(), { deleted: false });
    assert.throws(() => store.signCanonicalPayload(canonical), /not_enrolled/);
    assert.throws(() => createWindowsVoiceOwnerKeystore({
      platform: 'linux', baseDirectory: root, dpapi: makeTestDpapi()
    }), /windows_only/);
    console.log('ARIA Windows DPAPI Ed25519 owner-key contract: PASS');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  if (process.platform === 'win32') {
    const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-voice-v4-live-dpapi-'));
    try {
      const live = createWindowsVoiceOwnerKeystore({ baseDirectory: liveRoot, ownerId: '123e4567-e89b-42d3-a456-426614174000', deviceId: 'windows-lacueva-780886' });
      let key;
      try {
        key = live.getDeviceKey();
      } catch (error) {
        // GitHub-hosted Windows runners occasionally expose a profile where
        // CryptProtectData is unavailable. The deterministic mocked-DPAPI contract
        // above is the release gate; this live round-trip is best effort.
        if (!/^voice_dpapi_(operation_failed|response_invalid|response_empty)$/.test(String(error?.message))) throw error;
        console.log('ARIA Windows CurrentUser DPAPI live round-trip: SKIPPED (runner DPAPI unavailable)');
        return;
      }
      const canonical = canonicalizeOwnerSessionPayload(makePayload());
      const signature = live.signCanonicalPayload(canonical);
      assert.equal(verifySignature(Buffer.from(key.publicKey, 'base64url'), canonical, signature.signature), true);
      assert.deepEqual(live.deleteDeviceKey(), { deleted: true });
      console.log('ARIA Windows CurrentUser DPAPI live round-trip: PASS');
    } finally { fs.rmSync(liveRoot, { recursive: true, force: true }); }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
