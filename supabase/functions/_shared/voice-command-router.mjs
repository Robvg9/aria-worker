'use strict';

const LANES = Object.freeze({
  READ: 'read',
  DEVICE_ACTION: 'device.action',
  MISSION_EXECUTE: 'mission.execute'
});

const READ_OPERATIONS = new Set(['aria.status', 'device.status']);

const ACTIONS = Object.freeze({
  'display.brightness.set': {
    capability: 'display.brightness.write',
    risk: 'low',
    validate(params) {
      return isPlainObject(params)
        && Object.keys(params).length === 1
        && Number.isInteger(params.brightness)
        && params.brightness >= 0
        && params.brightness <= 100;
    }
  },
  'app.open': {
    capability: 'app.open',
    risk: 'low',
    validate(params, config) {
      return isPlainObject(params)
        && Object.keys(params).length === 1
        && typeof params.app_id === 'string'
        && config.allowedApps.has(params.app_id);
    }
  },
  'browser.open_url': {
    capability: 'browser.open_url',
    risk: 'medium',
    validate(params, config) {
      if (!isPlainObject(params) || Object.keys(params).length !== 1 || typeof params.url !== 'string') return false;
      try {
        const url = new URL(params.url);
        if (url.protocol !== 'https:' || url.username || url.password || url.hostname.length > 253) return false;
        if (!config.allowedUrlHosts.size) return false;
        return [...config.allowedUrlHosts].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      } catch {
        return false;
      }
    }
  }
});

const TOP_LEVEL_FIELDS = new Set([
  'request_id', 'idempotency_key', 'expires_at', 'lane', 'operation',
  'device_id', 'source_device_id', 'params', 'owner_session', 'source', 'mission_id', 'job_id',
  'command', 'shell', 'transcript', 'raw_audio'
]);

const SAFE_RESULT_FIELDS = new Set([
  'state', 'brightness', 'app_id', 'url', 'opened', 'device_id', 'operation'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validIdentifier(value, min = 8, max = 128) {
  return typeof value === 'string' && value.length >= min && value.length <= max
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function normalizeHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || host.includes('/') || host.includes(':')) return null;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host)) return null;
  return host;
}

function sanitizeActionResult(result, deviceId, operation, config = {}) {
  if (!isPlainObject(result)) return { status: 'succeeded', device_id: deviceId, operation };
  const safe = { status: 'succeeded', device_id: deviceId, operation };
  const allowedApps = config.allowedApps instanceof Set ? config.allowedApps : new Set();
  const allowedUrlHosts = config.allowedUrlHosts instanceof Set ? config.allowedUrlHosts : new Set();

  for (const key of SAFE_RESULT_FIELDS) {
    if (key === 'device_id' || key === 'operation') continue;
    const value = result[key];

    if (key === 'app_id') {
      if (typeof value === 'string' && allowedApps.has(value)) safe.app_id = value;
      continue;
    }

    if (key === 'url') {
      if (typeof value !== 'string' || value.length > 2048) continue;
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
        const hostAllowed = [...allowedUrlHosts].some(host =>
          parsed.hostname === host || parsed.hostname.endsWith('.' + host)
        );
        if (!hostAllowed) continue;
        // Never reflect bearer tokens, OAuth codes, or state values from an adapter.
        parsed.search = '';
        parsed.hash = '';
        const clean = parsed.toString();
        if (clean.length <= 160) safe.url = clean;
      } catch {
        // Malformed adapter URLs are intentionally omitted.
      }
      continue;
    }

    if (typeof value === 'string' && value.length <= 160) safe[key] = value;
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) safe[key] = value;
  }
  return safe;
}

function validateRequestShape(request, now, maxFutureMs) {
  if (!isPlainObject(request)) return 'request_invalid';
  for (const key of Object.keys(request)) if (!TOP_LEVEL_FIELDS.has(key)) return 'unsupported_request_field';
  if (!validIdentifier(request.request_id, 8, 128)) return 'request_id_invalid';
  if (!validIdentifier(request.source_device_id, 4, 160)) return 'source_device_id_required';
  if (!validIdentifier(request.idempotency_key, 16, 128)) return 'idempotency_key_invalid';
  if (!Number.isInteger(request.expires_at) || request.expires_at <= now || request.expires_at > now + maxFutureMs) {
    return 'request_expired_or_ttl_invalid';
  }
  if (request.source !== 'voice') return 'request_source_invalid';
  if (!Object.values(LANES).includes(request.lane)) return 'lane_invalid';
  if (typeof request.operation !== 'string' || !request.operation) return 'operation_required';
  if (!isPlainObject(request.params || {})) return 'params_invalid';
  if (!isPlainObject(request.owner_session)) return 'owner_session_required';
  if (request.lane !== LANES.MISSION_EXECUTE && (request.mission_id !== undefined || request.job_id !== undefined)) {
    return 'mission_context_forbidden_on_direct_lane';
  }
  if (request.lane === LANES.MISSION_EXECUTE) {
    if (request.operation !== 'mission.start') return 'mission_operation_not_allowed';
    if (!validIdentifier(request.mission_id, 8, 160)) return 'mission_id_required';
    if (request.job_id !== undefined) return 'mission_job_context_forbidden';
  }
  if (request.command !== undefined || request.shell !== undefined || request.transcript !== undefined || request.raw_audio !== undefined) {
    return 'raw_command_or_audio_forbidden';
  }
  return null;
}

function createVoiceCommandRouter({
  authenticatedOwnerId,
  verifyOwnerSession,
  authorizeCapability,
  resolveDevice,
  readStatus,
  executeAction,
  idempotencyStore,
  isMissionExecutionPaused = () => true,
  allowedApps = [],
  allowedUrlHosts = [],
  now = Date.now,
  maxRequestTtlMs = 30000
} = {}) {
  if (!validIdentifier(authenticatedOwnerId, 8, 128)) {
    throw new TypeError('authenticatedOwnerId from the validated API session is required');
  }
  const required = { verifyOwnerSession, authorizeCapability, resolveDevice, readStatus, executeAction };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(name + ' function required');
  }
  if (!idempotencyStore || typeof idempotencyStore.claim !== 'function') {
    throw new TypeError('idempotencyStore.claim function required');
  }
  if (typeof isMissionExecutionPaused !== 'function') throw new TypeError('isMissionExecutionPaused function required');
  if (!Number.isInteger(maxRequestTtlMs) || maxRequestTtlMs < 1000 || maxRequestTtlMs > 120000) {
    throw new TypeError('maxRequestTtlMs must be between 1000 and 120000');
  }

  const config = Object.freeze({
    ownerId: authenticatedOwnerId,
    allowedApps: new Set(allowedApps.filter(value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value))),
    allowedUrlHosts: new Set(allowedUrlHosts.map(normalizeHost).filter(Boolean))
  });

  async function route(request) {
    let currentTime;
    try {
      currentTime = Number(now());
    } catch {
      return { status: 'blocked', reason: 'clock_unavailable', executed: false };
    }
    if (!Number.isFinite(currentTime)) return { status: 'blocked', reason: 'clock_unavailable', executed: false };
    const shapeError = validateRequestShape(request, currentTime, maxRequestTtlMs);
    if (shapeError) return { status: 'blocked', reason: shapeError, executed: false };

    if (request.lane === LANES.MISSION_EXECUTE) {
      try {
        if (isMissionExecutionPaused()) {
          return { status: 'blocked', reason: 'mission_execution_paused', executed: false };
        }
      } catch {
        return { status: 'blocked', reason: 'mission_pause_state_unavailable', executed: false };
      }
      let missionAuth;
      try {
        missionAuth = await verifyOwnerSession(request.owner_session, {
          requireSpeaker: true,
          requestId: request.request_id,
          expiresAt: request.expires_at,
          expectedOwnerId: config.ownerId,
          deviceId: request.source_device_id,
          operation: request.operation,
          lane: request.lane
        });
      } catch {
        return { status: 'blocked', reason: 'owner_session_verification_failed', executed: false };
      }
      if (!missionAuth || missionAuth.valid !== true || !missionAuth.ownerId || missionAuth.speakerVerified !== true) {
        return { status: 'blocked', reason: 'owner_speaker_verification_required', executed: false };
      }
      return { status: 'confirmation_required', reason: 'mission_human_confirmation_required', executed: false };
    }

    const isRead = request.lane === LANES.READ;
    if (isRead && !READ_OPERATIONS.has(request.operation)) {
      return { status: 'blocked', reason: 'read_operation_not_allowed', executed: false };
    }

    if (request.operation === 'message.send') {
      if (request.lane !== LANES.DEVICE_ACTION) {
        return { status: 'blocked', reason: 'message_send_not_a_read_operation', executed: false };
      }
      let auth;
      try {
        auth = await verifyOwnerSession(request.owner_session, {
          requireSpeaker: true,
          requestId: request.request_id,
          expiresAt: request.expires_at,
          expectedOwnerId: config.ownerId,
          deviceId: request.source_device_id,
          operation: request.operation,
          lane: request.lane
        });
      } catch {
        return { status: 'blocked', reason: 'owner_session_verification_failed', executed: false };
      }
      if (!auth || auth.valid !== true || auth.speakerVerified !== true || !auth.ownerId) {
        return { status: 'blocked', reason: 'owner_speaker_verification_required', executed: false };
      }
      const params = request.params;
      if (!isPlainObject(params) || Object.keys(params).some(key => !['recipient_id', 'body'].includes(key))
        || !validIdentifier(params.recipient_id, 3, 160)
        || typeof params.body !== 'string' || !params.body.trim() || params.body.length > 2000) {
        return { status: 'blocked', reason: 'message_draft_invalid', executed: false };
      }
      return {
        status: 'confirmation_required',
        reason: 'message_requires_explicit_recipient_and_content_confirmation',
        executed: false,
        preview: { recipient_id: params.recipient_id, body: params.body.trim() },
        confirmation_channel: 'visible_authenticated_ui'
      };
    }

    if (!isRead && request.lane !== LANES.DEVICE_ACTION) {
      return { status: 'blocked', reason: 'lane_not_supported', executed: false };
    }
    const globalRead = isRead && request.operation === 'aria.status';
    if (globalRead && request.device_id !== undefined) {
      return { status: 'blocked', reason: 'global_status_must_not_target_device', executed: false };
    }
    if (!globalRead && (!request.device_id || !validIdentifier(request.device_id, 4, 160))) {
      return { status: 'blocked', reason: 'explicit_device_target_required', executed: false };
    }

    const operationPolicy = globalRead
      ? { capability: 'aria.status.read', risk: 'read', validate: params => Object.keys(params).length === 0 }
      : isRead
        ? { capability: 'device.telemetry', risk: 'read', validate: params => Object.keys(params).length === 0 }
        : ACTIONS[request.operation];
    if (!operationPolicy) return { status: 'blocked', reason: 'device_action_not_allowlisted', executed: false };
    if (!operationPolicy.validate(request.params || {}, config)) {
      return { status: 'blocked', reason: 'device_action_params_invalid', executed: false };
    }

    let auth;
    try {
      auth = await verifyOwnerSession(request.owner_session, {
        requireSpeaker: !isRead,
        requestId: request.request_id,
        expiresAt: request.expires_at,
        expectedOwnerId: config.ownerId,
        deviceId: request.source_device_id,
        operation: request.operation,
        lane: request.lane
      });
    } catch {
      return { status: 'blocked', reason: 'owner_session_verification_failed', executed: false };
    }
    if (!auth || auth.valid !== true || !auth.ownerId || (!isRead && auth.speakerVerified !== true)) {
      return { status: 'blocked', reason: isRead ? 'owner_session_invalid' : 'owner_speaker_verification_required', executed: false };
    }

    let device = null;
    if (!globalRead) {
      try {
        device = await resolveDevice(request.device_id);
      } catch {
        return { status: 'blocked', reason: 'device_lookup_failed', executed: false };
      }
      if (!device || device.device_id !== request.device_id || device.health !== 'healthy' || device.security !== 'trusted') {
        return { status: 'blocked', reason: 'device_not_trusted_and_healthy', executed: false };
      }
      if (!Array.isArray(device.capabilities) || !device.capabilities.includes(operationPolicy.capability)) {
        return { status: 'blocked', reason: 'device_capability_missing', executed: false };
      }
    }

    let authorization;
    try {
      authorization = await authorizeCapability({
        ownerId: auth.ownerId,
        deviceId: globalRead ? null : request.device_id,
        operation: request.operation,
        capability: operationPolicy.capability,
        risk: operationPolicy.risk,
        lane: request.lane
      });
    } catch {
      return { status: 'blocked', reason: 'capability_authorization_unavailable', executed: false };
    }
    if (!authorization || authorization.allowed !== true) {
      return { status: 'blocked', reason: authorization?.reason || 'capability_denied', executed: false };
    }

    let claimed;
    try {
      claimed = await idempotencyStore.claim({
        ownerId: config.ownerId,
        key: request.idempotency_key,
        requestId: request.request_id,
        deviceId: globalRead ? null : request.device_id,
        operation: request.operation,
        expiresAt: request.expires_at
      });
    } catch {
      return { status: 'blocked', reason: 'idempotency_store_unavailable', executed: false };
    }
    if (claimed !== true) return { status: 'duplicate', reason: 'idempotency_key_already_claimed', executed: false };

    if (isRead) {
      try {
        const result = await readStatus({ device, operation: request.operation, requestId: request.request_id });
        return { status: 'succeeded', executed: false, result: sanitizeActionResult(result, device?.device_id || null, request.operation, config) };
      } catch {
        return { status: 'failed', reason: 'read_status_failed', executed: false };
      }
    }

    try {
      const result = await executeAction({
        device,
        sourceDeviceId: request.source_device_id,
        operation: request.operation,
        params: request.params || {},
        requestId: request.request_id,
        idempotencyKey: request.idempotency_key,
        ownerId: auth.ownerId
      });
      if (!result || result.ok !== true) return { status: 'failed', reason: 'device_action_failed', executed: false };
      if (result.status === 'duplicate' || result.duplicate === true) {
        return { status: 'duplicate', reason: 'idempotency_key_already_claimed', executed: false };
      }
      if (result.status === 'queued' || result.queued === true) {
        if (typeof result.command_id !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.command_id)) {
          return { status: 'failed', reason: 'device_queue_ack_invalid', executed: false };
        }
        return {
          status: 'queued',
          executed: false,
          command_id: result.command_id,
          device_id: device.device_id,
          operation: request.operation
        };
      }
      return { status: 'succeeded', executed: true, result: sanitizeActionResult(result, device.device_id, request.operation, config) };
    } catch {
      return { status: 'failed', reason: 'device_action_failed', executed: false };
    }
  }

  return Object.freeze({ route });
}

export {
  LANES, READ_OPERATIONS, ACTIONS, createVoiceCommandRouter, validateRequestShape, sanitizeActionResult
};
