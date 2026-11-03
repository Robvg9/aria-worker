'use strict';

const SESSION_VERSION = 'aria-owner-session-v1';
const SESSION_FIELDS = Object.freeze([
  'activation_id',
  'device_id',
  'expires_at',
  'issued_at',
  'nonce',
  'owner_id',
  'request_id',
  'session_id',
  'speaker_model_id',
  'speaker_score',
  'speaker_verified',
  'version'
]);
const SESSION_FIELD_SET = new Set(SESSION_FIELDS);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validIdentifier(value, min = 8, max = 160) {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('signature_encoding_invalid');
  }
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function canonicalSessionPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('session_payload_invalid');
  const keys = Object.keys(payload).sort();
  for (const key of keys) {
    if (!SESSION_FIELD_SET.has(key)) throw new Error('session_payload_field_unsupported');
    const value = payload[key];
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('session_payload_value_invalid');
    }
  }
  const canonical = {};
  for (const key of keys) canonical[key] = payload[key];
  return JSON.stringify(canonical);
}

function validateSessionPayload(payload, options, now, maxTtlMs, clockSkewMs) {
  try {
    canonicalSessionPayload(payload);
  } catch (error) {
    return error.message || 'session_payload_invalid';
  }

  if (Object.keys(payload).length !== SESSION_FIELDS.length) return 'session_payload_fields_missing';
  if (payload.version !== SESSION_VERSION) return 'session_version_unsupported';
  if (!validIdentifier(payload.owner_id)) return 'session_owner_invalid';
  if (options.expectedOwnerId && payload.owner_id !== options.expectedOwnerId) return 'session_owner_mismatch';
  if (!validIdentifier(payload.device_id, 4)) return 'session_device_invalid';
  if (!validIdentifier(payload.session_id)) return 'session_id_invalid';
  if (!validIdentifier(payload.activation_id)) return 'activation_id_invalid';
  if (!validIdentifier(payload.request_id)) return 'request_id_invalid';
  if (!validIdentifier(payload.nonce, 24, 160)) return 'session_nonce_invalid';
  if (!Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)) {
    return 'session_time_invalid';
  }
  if (payload.issued_at > now + clockSkewMs) return 'session_issued_in_future';
  if (payload.expires_at <= now || payload.expires_at <= payload.issued_at) return 'session_expired';
  if (payload.expires_at - payload.issued_at > maxTtlMs) return 'session_ttl_exceeded';
  if (now - payload.issued_at > maxTtlMs + clockSkewMs) return 'session_too_old';
  if (options.requestId && payload.request_id !== options.requestId) return 'session_request_mismatch';
  if (Number.isSafeInteger(options.expiresAt) && payload.expires_at !== options.expiresAt) {
    return 'session_expiry_mismatch';
  }
  if (options.deviceId && payload.device_id !== options.deviceId) return 'session_device_mismatch';
  if (typeof payload.speaker_verified !== 'boolean') return 'speaker_result_invalid';
  if (payload.speaker_model_id !== null && typeof payload.speaker_model_id !== 'string') {
    return 'speaker_model_id_invalid';
  }
  if (payload.speaker_score !== null
      && (typeof payload.speaker_score !== 'number' || !Number.isFinite(payload.speaker_score)
        || payload.speaker_score < 0 || payload.speaker_score > 1)) {
    return 'speaker_score_invalid';
  }
  if (options.requireSpeaker === true) {
    if (payload.speaker_verified !== true) return 'speaker_verification_required';
    if (!validIdentifier(payload.speaker_model_id, 3, 160)) return 'speaker_model_required';
    if (typeof payload.speaker_score !== 'number') return 'speaker_score_required';
  }
  return null;
}

function createOwnerSessionVerifier({
  resolveTrustedDeviceKey,
  resolveSpeakerPolicy,
  nonceStore,
  cryptoProvider = globalThis.crypto,
  now = Date.now,
  maxTtlMs = 30000,
  clockSkewMs = 5000
} = {}) {
  if (typeof resolveTrustedDeviceKey !== 'function') {
    throw new TypeError('resolveTrustedDeviceKey function required');
  }
  if (typeof resolveSpeakerPolicy !== 'function') {
    throw new TypeError('resolveSpeakerPolicy function required');
  }
  if (!nonceStore || typeof nonceStore.consume !== 'function') {
    throw new TypeError('nonceStore.consume function required');
  }
  if (!cryptoProvider?.subtle || typeof cryptoProvider.subtle.importKey !== 'function') {
    throw new TypeError('WebCrypto SubtleCrypto required');
  }
  if (!Number.isInteger(maxTtlMs) || maxTtlMs < 1000 || maxTtlMs > 120000) {
    throw new TypeError('maxTtlMs must be between 1000 and 120000');
  }
  if (!Number.isInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > 30000) {
    throw new TypeError('clockSkewMs must be between 0 and 30000');
  }

  return async function verifyOwnerSession(session, options = {}) {
    const currentTime = Number(now());
    if (!Number.isSafeInteger(currentTime)) return { valid: false, reason: 'clock_unavailable' };
    if (!isPlainObject(session) || Object.keys(session).length !== 2
        || !isPlainObject(session.payload) || typeof session.signature !== 'string') {
      return { valid: false, reason: 'owner_session_shape_invalid' };
    }

    const payload = session.payload;
    const shapeError = validateSessionPayload(payload, options, currentTime, maxTtlMs, clockSkewMs);
    if (shapeError) return { valid: false, reason: shapeError };

    let device;
    try {
      device = await resolveTrustedDeviceKey(payload.device_id);
    } catch {
      return { valid: false, reason: 'trusted_device_lookup_failed' };
    }
    if (!device
        || device.device_id !== payload.device_id
        || device.owner_id !== payload.owner_id
        || device.security !== 'trusted'
        || device.health !== 'healthy'
        || device.enabled !== true) {
      return { valid: false, reason: 'owner_session_device_not_trusted' };
    }

    if (options.requireSpeaker === true) {
      let speakerPolicy;
      try {
        speakerPolicy = await resolveSpeakerPolicy({
          ownerId: payload.owner_id,
          deviceId: payload.device_id,
          operation: options.operation || null
        });
      } catch {
        return { valid: false, reason: 'speaker_policy_unavailable' };
      }
      if (!speakerPolicy || speakerPolicy.enabled !== true
          || speakerPolicy.modelId !== payload.speaker_model_id
          || !Number.isFinite(speakerPolicy.minimumScore)
          || speakerPolicy.minimumScore < 0 || speakerPolicy.minimumScore > 1
          || payload.speaker_score < speakerPolicy.minimumScore) {
        return { valid: false, reason: 'speaker_policy_rejected' };
      }
    }

    let publicKey;
    try {
      const encoded = device.public_key;
      if (typeof encoded !== 'string') return { valid: false, reason: 'device_public_key_missing' };
      const rawKey = decodeBase64Url(encoded);
      if (rawKey.length !== 32) return { valid: false, reason: 'device_public_key_invalid' };
      publicKey = await cryptoProvider.subtle.importKey(
        'raw',
        rawKey,
        { name: 'Ed25519' },
        false,
        ['verify']
      );
    } catch {
      return { valid: false, reason: 'device_public_key_invalid' };
    }

    let signature;
    let signedBytes;
    try {
      signature = decodeBase64Url(session.signature);
      signedBytes = new TextEncoder().encode(canonicalSessionPayload(payload));
    } catch {
      return { valid: false, reason: 'owner_session_signature_encoding_invalid' };
    }

    let signatureValid = false;
    try {
      signatureValid = await cryptoProvider.subtle.verify(
        { name: 'Ed25519' },
        publicKey,
        signature,
        signedBytes
      );
    } catch {
      return { valid: false, reason: 'owner_session_signature_check_failed' };
    }
    if (!signatureValid) return { valid: false, reason: 'owner_session_signature_invalid' };

    let consumed;
    try {
      consumed = await nonceStore.consume({
        nonce: payload.nonce,
        deviceId: payload.device_id,
        ownerId: payload.owner_id,
        sessionId: payload.session_id,
        requestId: payload.request_id,
        expiresAt: payload.expires_at
      });
    } catch {
      return { valid: false, reason: 'owner_session_nonce_store_unavailable' };
    }
    if (consumed !== true) return { valid: false, reason: 'owner_session_replayed' };

    return {
      valid: true,
      ownerId: payload.owner_id,
      deviceId: payload.device_id,
      sessionId: payload.session_id,
      speakerVerified: payload.speaker_verified === true,
      speakerModelId: payload.speaker_model_id,
      speakerScore: payload.speaker_score,
      activationId: payload.activation_id
    };
  };
}

export {
  SESSION_VERSION, SESSION_FIELDS, canonicalSessionPayload,
  validateSessionPayload, encodeBase64Url, decodeBase64Url,
  createOwnerSessionVerifier
};
