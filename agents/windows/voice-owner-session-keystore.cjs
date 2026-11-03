'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEY_VERSION = 1;
const KEY_ID = 'aria-windows-dpapi-ed25519-v1';
const KEY_FILE = 'owner-ed25519.dpapi.json';
const MAX_SIGNED_PAYLOAD_BYTES = 8192;
const MAX_SESSION_TTL_MS = 30000;
const SESSION_VERSION = 'aria-owner-session-v1';
const SESSION_FIELDS = Object.freeze([
  'activation_id', 'device_id', 'expires_at', 'issued_at', 'nonce',
  'owner_id', 'request_id', 'session_id', 'speaker_model_id',
  'speaker_score', 'speaker_verified', 'version'
]);
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function validIdentifier(value, min = 8, max = 160) {
  return typeof value === 'string' && value.length >= min && value.length <= max
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function canonicalizeOwnerSessionPayload(input, options = {}) {
  const now = Number.isSafeInteger(options.now) ? options.now : Date.now();
  let payload = input;
  let original = null;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_SIGNED_PAYLOAD_BYTES) throw new Error('voice_owner_payload_size_invalid');
    original = input;
    try { payload = JSON.parse(input); } catch { throw new Error('voice_owner_payload_json_invalid'); }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('voice_owner_payload_invalid');
  const keys = Object.keys(payload).sort();
  const expected = [...SESSION_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('voice_owner_session_fields_invalid');
  }
  for (const key of keys) {
    const value = payload[key];
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('voice_owner_session_value_invalid');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('voice_owner_session_number_invalid');
  }
  if (payload.version !== SESSION_VERSION
      || !validIdentifier(payload.owner_id)
      || !validIdentifier(payload.device_id, 4)
      || !validIdentifier(payload.session_id)
      || !validIdentifier(payload.activation_id)
      || !validIdentifier(payload.request_id)
      || !validIdentifier(payload.nonce, 24, 160)) {
    throw new Error('voice_owner_session_identity_invalid');
  }
  if (options.ownerId && payload.owner_id !== options.ownerId) throw new Error('voice_owner_session_owner_mismatch');
  if (options.deviceId && payload.device_id !== options.deviceId) throw new Error('voice_owner_session_device_mismatch');
  if (!Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)
      || payload.issued_at > now + 5000
      || payload.expires_at <= now
      || payload.expires_at <= payload.issued_at
      || payload.expires_at - payload.issued_at > MAX_SESSION_TTL_MS) {
    throw new Error('voice_owner_session_time_invalid');
  }
  if (payload.speaker_verified !== false) throw new Error('voice_owner_session_speaker_verification_unavailable');
  if (payload.speaker_model_id !== null || payload.speaker_score !== null) {
    throw new Error('voice_owner_session_unverified_speaker_data_forbidden');
  }
  const canonical = {};
  for (const key of keys) canonical[key] = payload[key];
  const serialized = JSON.stringify(canonical);
  if (original !== null && original !== serialized) throw new Error('voice_owner_session_payload_not_canonical');
  return serialized;
}

function defaultDpapiTransform(operation, bytes) {
  if (process.platform !== 'win32') throw new Error('voice_dpapi_windows_only');
  if (!['protect', 'unprotect'].includes(operation)) throw new Error('voice_dpapi_operation_invalid');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json',
    '$inputBytes = [Convert]::FromBase64String([string]$request.payload)',
    "$entropy = [Text.Encoding]::UTF8.GetBytes('ARIA Voice V4 Windows owner key v1')",
    "if ($request.operation -eq 'protect') {",
    '  $outputBytes = [System.Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '} else {',
    '  $outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '}',
    '[Console]::Out.Write([Convert]::ToBase64String($outputBytes))'
  ].join('\n');
  let stdout;
  try {
    stdout = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      input: JSON.stringify({ operation, payload: Buffer.from(bytes).toString('base64') }),
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 16384,
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch {
    throw new Error('voice_dpapi_operation_failed');
  }
  const encoded = String(stdout || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('voice_dpapi_response_invalid');
  const result = Buffer.from(encoded, 'base64');
  if (!result.length) throw new Error('voice_dpapi_response_empty');
  return result;
}

function createWindowsVoiceOwnerKeystore(options = {}) {
  const platform = options.platform || process.platform;
  const dpapi = options.dpapi || {
    protect: bytes => defaultDpapiTransform('protect', bytes),
    unprotect: bytes => defaultDpapiTransform('unprotect', bytes)
  };
  const baseDirectory = options.baseDirectory || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (platform !== 'win32') throw new Error('voice_dpapi_windows_only');
  const ownerId = options.ownerId;
  const deviceId = options.deviceId;
  if (!validIdentifier(ownerId) || !validIdentifier(deviceId, 4)) {
    throw new Error('voice_dpapi_owner_and_device_required');
  }
  if (!path.isAbsolute(baseDirectory)) throw new Error('voice_dpapi_storage_path_invalid');
  if (typeof dpapi.protect !== 'function' || typeof dpapi.unprotect !== 'function') {
    throw new TypeError('voice_dpapi_adapter_invalid');
  }

  const directory = path.join(baseDirectory, 'ARIA', 'VoiceV4');
  const filePath = path.join(directory, KEY_FILE);

  function readRecord() {
    let stat;
    try { stat = fs.lstatSync(filePath); } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw new Error('voice_dpapi_keystore_read_failed');
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 64 || stat.size > 16384) {
      throw new Error('voice_dpapi_keystore_file_invalid');
    }
    let record;
    try { record = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {
      throw new Error('voice_dpapi_keystore_record_invalid');
    }
    if (record.version !== KEY_VERSION || record.algorithm !== 'Ed25519'
        || record.key_id !== KEY_ID
        || record.owner_id !== ownerId || record.device_id !== deviceId
        || typeof record.public_key !== 'string'
        || typeof record.fingerprint_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint_sha256)
        || typeof record.protected_private_key !== 'string'
        || !/^[A-Za-z0-9+/]+=*$/.test(record.protected_private_key)
        || (record.protected_device_token !== undefined
          && (typeof record.protected_device_token !== 'string'
            || !/^[A-Za-z0-9+/]+=*$/.test(record.protected_device_token)))) {
      throw new Error('voice_dpapi_keystore_record_invalid');
    }
    return record;
  }

  function persistRecord(record) {
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = path.join(directory, KEY_FILE + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    try {
      fs.writeFileSync(tempPath, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      try { fs.renameSync(tempPath, filePath); } catch (error) {
        try { fs.unlinkSync(tempPath); } catch {}
        if (error && ['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) {
          const existing = readRecord();
          if (existing) return existing;
        }
        throw error;
      }
    } catch {
      try { fs.unlinkSync(tempPath); } catch {}
      throw new Error('voice_dpapi_keystore_write_failed');
    }
    return record;
  }

  function loadDeviceToken(record) {
    if (!record || record.protected_device_token === undefined) return null;
    const protectedBytes = Buffer.from(record.protected_device_token, 'base64');
    let tokenBytes;
    try { tokenBytes = dpapi.unprotect(protectedBytes); } catch {
      throw new Error('voice_dpapi_device_token_unprotect_failed');
    } finally { protectedBytes.fill(0); }
    if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== 32) {
      if (Buffer.isBuffer(tokenBytes)) tokenBytes.fill(0);
      throw new Error('voice_dpapi_device_token_invalid');
    }
    try { return base64Url(tokenBytes); } finally { tokenBytes.fill(0); }
  }

  function getOrCreateDeviceToken(record) {
    let current = record;
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = loadDeviceToken(current);
      if (existing) return existing;
      const tokenBytes = crypto.randomBytes(32);
      let protectedBytes;
      try { protectedBytes = dpapi.protect(tokenBytes); } finally { tokenBytes.fill(0); }
      if (!Buffer.isBuffer(protectedBytes) || protectedBytes.length < 32 || protectedBytes.length > 8192) {
        if (Buffer.isBuffer(protectedBytes)) protectedBytes.fill(0);
        throw new Error('voice_dpapi_protected_device_token_invalid');
      }
      const nextRecord = { ...current, protected_device_token: protectedBytes.toString('base64') };
      protectedBytes.fill(0);
      current = persistRecord(nextRecord);
      if (!current.protected_device_token) {
        current = readRecord();
        if (!current) throw new Error('voice_dpapi_keystore_read_failed');
      }
    }
    throw new Error('voice_dpapi_device_token_persist_failed');
  }

  function createRecord() {
    const pair = crypto.generateKeyPairSync('ed25519');
    const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
    const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });
    if (publicDer.length !== 44 || !publicDer.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
      privateDer.fill(0);
      throw new Error('voice_ed25519_public_key_format_unsupported');
    }
    const publicRaw = publicDer.subarray(12);
    let protectedBytes;
    try { protectedBytes = dpapi.protect(privateDer); } finally { privateDer.fill(0); }
    if (!Buffer.isBuffer(protectedBytes) || protectedBytes.length < 32 || protectedBytes.length > 8192) {
      throw new Error('voice_dpapi_protected_key_invalid');
    }
    const record = {
      version: KEY_VERSION,
      algorithm: 'Ed25519',
      key_id: KEY_ID,
      owner_id: ownerId,
      device_id: deviceId,
      public_key: base64Url(publicRaw),
      fingerprint_sha256: crypto.createHash('sha256').update(publicRaw).digest('hex'),
      protected_private_key: protectedBytes.toString('base64')
    };
    protectedBytes.fill(0);
    return persistRecord(record);
  }

  function loadPrivateKey(record) {
    const protectedBytes = Buffer.from(record.protected_private_key, 'base64');
    let privateDer;
    try { privateDer = dpapi.unprotect(protectedBytes); } catch {
      throw new Error('voice_dpapi_key_unprotect_failed');
    } finally { protectedBytes.fill(0); }
    if (!Buffer.isBuffer(privateDer) || privateDer.length < 32 || privateDer.length > 4096) {
      throw new Error('voice_dpapi_private_key_invalid');
    }
    try {
      const privateKey = crypto.createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' });
      const publicDer = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
      if (publicDer.length !== 44 || !publicDer.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
        throw new Error('voice_ed25519_public_key_format_unsupported');
      }
      const publicRaw = publicDer.subarray(12);
      const fingerprint = crypto.createHash('sha256').update(publicRaw).digest('hex');
      if (base64Url(publicRaw) !== record.public_key || fingerprint !== record.fingerprint_sha256) {
        throw new Error('voice_dpapi_keypair_mismatch');
      }
      return privateKey;
    } finally { privateDer.fill(0); }
  }

  return Object.freeze({
    filePath,
    getDeviceKey() {
      const record = readRecord() || createRecord();
      return Object.freeze({
        algorithm: 'Ed25519',
        keyId: record.key_id,
        ownerId: record.owner_id,
        deviceId: record.device_id,
        publicKey: record.public_key,
        fingerprintSha256: record.fingerprint_sha256,
        keyStorage: 'WindowsDPAPI_CurrentUser'
      });
    },
    getDeviceToken() {
      const record = readRecord() || createRecord();
      return getOrCreateDeviceToken(record);
    },
    getPairingMaterial() {
      const record = readRecord() || createRecord();
      const deviceToken = getOrCreateDeviceToken(record);
      return Object.freeze({
        ownerId: record.owner_id,
        deviceId: record.device_id,
        publicKeyId: record.key_id,
        publicKeyEd25519: record.public_key,
        publicKeyFingerprintSha256: record.fingerprint_sha256,
        deviceToken,
        keyStorage: 'WindowsDPAPI_CurrentUser'
      });
    },
    createReadOnlyOwnerSession(input, options = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('voice_windows_owner_session_request_invalid');
      }
      const expectedFields = ['expires_at', 'lane', 'operation', 'owner_id', 'request_id', 'target_device_id'];
      const keys = Object.keys(input).sort();
      if (keys.length !== expectedFields.length || keys.some((key, index) => key !== expectedFields[index])) {
        throw new Error('voice_windows_owner_session_fields_invalid');
      }
      if (input.owner_id !== ownerId || !validIdentifier(input.request_id, 8, 128)
          || input.lane !== 'read'
          || !['aria.status', 'device.status'].includes(input.operation)) {
        throw new Error('voice_windows_owner_session_read_only_required');
      }
      if (input.operation === 'aria.status' && input.target_device_id !== null) {
        throw new Error('voice_windows_owner_session_target_invalid');
      }
      if (input.operation === 'device.status' && !validIdentifier(input.target_device_id, 8, 160)) {
        throw new Error('voice_windows_owner_session_target_invalid');
      }
      const now = Number.isSafeInteger(options.now) ? options.now : Date.now();
      if (!Number.isSafeInteger(input.expires_at) || input.expires_at <= now
          || input.expires_at - now > 20000) {
        throw new Error('voice_windows_owner_session_expiry_invalid');
      }
      const payload = {
        activation_id: 'activation-' + crypto.randomUUID(),
        device_id: deviceId,
        expires_at: input.expires_at,
        issued_at: now,
        nonce: base64Url(crypto.randomBytes(32)),
        owner_id: ownerId,
        request_id: input.request_id,
        session_id: crypto.randomUUID(),
        speaker_model_id: null,
        speaker_score: null,
        speaker_verified: false,
        version: SESSION_VERSION
      };
      const canonical = canonicalizeOwnerSessionPayload(payload, { ownerId, deviceId, now });
      const signed = this.signCanonicalPayload(canonical);
      return Object.freeze({
        source_device_id: deviceId,
        owner_session: Object.freeze({ payload: Object.freeze(payload), signature: signed.signature })
      });
    },
    signCanonicalPayload(input) {
      const canonical = canonicalizeOwnerSessionPayload(input, { ownerId, deviceId });
      const record = readRecord();
      if (!record) throw new Error('voice_dpapi_device_key_not_enrolled');
      const privateKey = loadPrivateKey(record);
      return Object.freeze({
        algorithm: 'Ed25519',
        keyId: record.key_id,
        signature: base64Url(crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey))
      });
    },
    deleteDeviceKey() {
      try { fs.unlinkSync(filePath); return { deleted: true }; } catch (error) {
        if (error && error.code === 'ENOENT') return { deleted: false };
        throw new Error('voice_dpapi_keystore_delete_failed');
      }
    }
  });
}

module.exports = { createWindowsVoiceOwnerKeystore, canonicalizeOwnerSessionPayload, KEY_ID, SESSION_VERSION };
