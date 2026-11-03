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
    const store = createWindowsVoiceOwnerKeystore({ platform: 'win32', baseDirectory: root, dpapi: makeTestDpapi() });
    const key = store.getDeviceKey();
    assert.equal(key.algorithm, 'Ed25519');
    assert.equal(key.keyStorage, 'WindowsDPAPI_CurrentUser');
    assert.match(key.fingerprintSha256, /^[a-f0-9]{64}$/);

    const stored = fs.readFileSync(store.filePath, 'utf8');
    assert.equal(stored.includes('BEGIN PRIVATE KEY'), false);
    assert.equal(stored.includes('TEST-DPAPI:'), false);

    const canonical = canonicalizeOwnerSessionPayload(makePayload());
    const signed = store.signCanonicalPayload(canonical);
    assert.equal(verifySignature(Buffer.from(key.publicKey, 'base64url'), canonical, signed.signature), true);

    const tampered = JSON.parse(canonical);
    tampered.request_id = 'request-tampered-0001';
    assert.throws(() => store.signCanonicalPayload(JSON.stringify(tampered)), /not_canonical/);

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
      const live = createWindowsVoiceOwnerKeystore({ baseDirectory: liveRoot });
      const key = live.getDeviceKey();
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
