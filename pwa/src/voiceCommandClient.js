'use strict';

const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_ALIASES = Object.freeze({
  chrome: 'chrome',
  'google chrome': 'chrome',
  youtube: 'youtube',
  notepad: 'notepad',
  'bloc de notas': 'notepad',
  calculator: 'calculator',
  calculadora: 'calculator'
});
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'expired', 'cancelled']);
const COMMAND_STATUSES = new Set(['queued', 'claimed', 'running', ...TERMINAL_STATUSES]);

function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, ' ')
    .trim();
}

function resolveExplicitDevice(label, devices) {
  const wanted = normalizeLabel(label);
  if (!wanted || !Array.isArray(devices)) return { status: 'not_found' };
  const matches = devices.filter(device => {
    if (!device || typeof device !== 'object') return false;
    const values = [
      device.device_id,
      device.display_name,
      device.name,
      device.hostname,
      device.agent_id,
      ...(Array.isArray(device.aliases) ? device.aliases : [])
    ];
    return values.some(value => normalizeLabel(value) === wanted);
  });
  if (matches.length !== 1) return { status: matches.length > 1 ? 'ambiguous' : 'not_found' };
  const deviceId = String(matches[0].device_id ?? '');
  if (!DEVICE_ID_RE.test(deviceId)) return { status: 'invalid' };
  return { status: 'matched', device: matches[0], deviceId };
}

function unresolvedDeviceIntent(label, devices, operation, params) {
  const match = resolveExplicitDevice(label, devices);
  if (match.status !== 'matched') {
    return {
      error: match.status === 'ambiguous' ? 'voice_device_target_ambiguous'
        : match.status === 'invalid' ? 'voice_device_target_invalid' : 'voice_device_target_not_found',
      requestedTarget: String(label).trim()
    };
  }
  return {
    lane: operation === 'device.status' ? 'read' : 'device.action',
    operation,
    device_id: match.deviceId,
    params
  };
}

/**
 * Parse only small, explicit command phrases. Anything else remains normal
 * conversation. Never infer a target device or broaden the action allowlist.
 */
function parseExplicitVoiceAction(transcript, devices = []) {
  const text = String(transcript ?? '').trim().replace(/[.!?]+$/, '');
  if (!text || text.length > 500) return null;

  if (/^(?:(?:oye|hey)\s+)?aria\s*,?\s*(?:dime\s+)?(?:el\s+)?estado(?:\s+general)?$/i.test(text)
      || /^estado\s+de\s+aria$/i.test(text)) {
    return { lane: 'read', operation: 'aria.status', params: {} };
  }

  let match = text.match(/^(?:dime\s+)?(?:el\s+)?estado\s+de\s+(.+)$/i);
  if (match) return unresolvedDeviceIntent(match[1], devices, 'device.status', {});

  match = text.match(/^(?:pon|ajusta|establece|configura)\s+(?:el\s+)?brillo(?:\s+de\s+la\s+pantalla)?\s+(?:al?|en)\s*(\d{1,3})\s*%?\s+(?:en|de)\s+(.+)$/i);
  if (match) {
    const brightness = Number(match[1]);
    if (!Number.isInteger(brightness) || brightness < 0 || brightness > 100) {
      return { error: 'voice_brightness_value_invalid' };
    }
    return unresolvedDeviceIntent(match[2], devices, 'display.brightness.set', { brightness });
  }

  match = text.match(/^abre\s+(https:\/\/[^\s]+)\s+(?:en|desde)\s+(.+)$/i);
  if (match) {
    let url;
    try {
      url = new URL(match[1]);
      if (url.protocol !== 'https:' || url.username || url.password) return { error: 'voice_url_not_allowlisted' };
    } catch {
      return { error: 'voice_url_invalid' };
    }
    return unresolvedDeviceIntent(match[2], devices, 'browser.open_url', { url: url.toString() });
  }

  match = text.match(/^abre\s+(.+?)\s+(?:en|desde)\s+(.+)$/i);
  if (match) {
    const appId = APP_ALIASES[normalizeLabel(match[1])];
    if (!appId) return null;
    return unresolvedDeviceIntent(match[2], devices, 'app.open', { app_id: appId });
  }

  return null;
}

function validateSignedBridgeResult(signed, expected) {
  if (!signed || typeof signed !== 'object' || Array.isArray(signed)) {
    throw new Error('voice_v4_native_signer_invalid');
  }
  const sourceDeviceId = String(signed.source_device_id ?? '');
  const ownerSession = signed.owner_session;
  if (!DEVICE_ID_RE.test(sourceDeviceId)
      || !ownerSession || typeof ownerSession !== 'object' || Array.isArray(ownerSession)
      || !ownerSession.payload || typeof ownerSession.payload !== 'object'
      || typeof ownerSession.signature !== 'string' || ownerSession.signature.length < 40) {
    throw new Error('voice_v4_native_signer_invalid');
  }
  const payload = ownerSession.payload;
  if (payload.device_id !== sourceDeviceId
      || payload.owner_id !== expected.ownerId
      || payload.request_id !== expected.requestId
      || payload.expires_at !== expected.expiresAt) {
    throw new Error('voice_v4_native_signer_context_mismatch');
  }
  if (expected.lane === 'device.action'
      && (payload.speaker_verified !== true
        || typeof payload.speaker_model_id !== 'string'
        || !payload.speaker_model_id
        || typeof payload.speaker_score !== 'number'
        || !Number.isFinite(payload.speaker_score)
        || payload.speaker_score < 0 || payload.speaker_score > 1)) {
    throw new Error('voice_v4_speaker_verification_unavailable');
  }
  return { sourceDeviceId, ownerSession };
}

async function dispatchVoiceAction({ api, bridge, intent, ownerId, now = Date.now, randomUUID } = {}) {
  if (intent?.error) throw new Error(intent.error);
  if (typeof api !== 'function') throw new TypeError('voice_command_api_required');
  if (!intent || !['read', 'device.action'].includes(intent.lane)
      || typeof intent.operation !== 'string' || !intent.operation
      || !intent.params || typeof intent.params !== 'object' || Array.isArray(intent.params)) {
    throw new Error('voice_command_intent_invalid');
  }
  if (intent.device_id !== undefined && !DEVICE_ID_RE.test(String(intent.device_id))) {
    throw new Error('voice_device_target_invalid');
  }
  if (!bridge || typeof bridge.createOwnerSession !== 'function') {
    throw new Error('voice_v4_native_signer_unavailable');
  }
  if (typeof ownerId !== 'string' || ownerId.length < 8 || ownerId.length > 128) {
    throw new Error('voice_v4_authenticated_owner_required');
  }
  const uuid = typeof randomUUID === 'function' ? randomUUID : () => globalThis.crypto.randomUUID();
  const requestId = uuid();
  const idempotencyKey = uuid();
  if (!COMMAND_ID_RE.test(requestId) || !COMMAND_ID_RE.test(idempotencyKey)) {
    throw new Error('voice_v4_request_identity_invalid');
  }
  const currentTime = Number(now());
  if (!Number.isSafeInteger(currentTime)) throw new Error('voice_v4_clock_unavailable');
  const expiresAt = currentTime + 20000;
  const signed = await bridge.createOwnerSession({
    owner_id: ownerId,
    request_id: requestId,
    expires_at: expiresAt,
    operation: intent.operation,
    lane: intent.lane,
    target_device_id: intent.device_id ?? null
  });
  const { sourceDeviceId, ownerSession } = validateSignedBridgeResult(signed, {
    ownerId, requestId, expiresAt, lane: intent.lane
  });
  const body = {
    request_id: requestId,
    idempotency_key: idempotencyKey,
    expires_at: expiresAt,
    lane: intent.lane,
    operation: intent.operation,
    source_device_id: sourceDeviceId,
    params: intent.params,
    owner_session: ownerSession,
    source: 'voice'
  };
  if (intent.device_id !== undefined) body.device_id = intent.device_id;
  const response = await api('/voice/commands', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return response;
}

async function getVoiceCommandStatus(api, commandId) {
  if (typeof api !== 'function') throw new TypeError('voice_command_api_required');
  if (typeof commandId !== 'string' || !COMMAND_ID_RE.test(commandId)) {
    throw new Error('voice_command_status_id_invalid');
  }
  const response = await api('/voice/commands/' + encodeURIComponent(commandId));
  const command = response?.command;
  const status = String(command?.status ?? '');
  const deviceId = typeof command?.device_id === 'string' ? command.device_id : '';
  const operation = String(command?.operation ?? '');
  const terminalStatus = TERMINAL_STATUSES.has(status);
  if (response?.ok !== true || !command || command.command_id !== commandId
      || !COMMAND_STATUSES.has(status)
      || !DEVICE_ID_RE.test(deviceId)
      || !['display.brightness.set', 'app.open', 'browser.open_url'].includes(operation)
      || typeof response.terminal !== 'boolean'
      || response.terminal !== terminalStatus) {
    throw new Error('voice_command_status_response_invalid');
  }
  const rawResult = command.result && typeof command.result === 'object' && !Array.isArray(command.result)
    ? command.result : {};
  const result = {};
  for (const key of ['ok', 'brightness', 'app_id', 'opened', 'verified']) {
    const value = rawResult[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
        || (typeof value === 'string' && value.length <= 160)) result[key] = value;
  }
  return {
    command_id: command.command_id,
    device_id: deviceId,
    operation,
    status,
    requested_at: command.requested_at ?? null,
    expires_at: command.expires_at ?? null,
    claimed_at: command.claimed_at ?? null,
    started_at: command.started_at ?? null,
    completed_at: command.completed_at ?? null,
    error_code: typeof command.error_code === 'string' ? command.error_code : null,
    result,
    terminal: response.terminal
  };
}

function isVoiceCommandTerminal(status) {
  return TERMINAL_STATUSES.has(String(status ?? ''));
}

export {
  parseExplicitVoiceAction,
  resolveExplicitDevice,
  dispatchVoiceAction,
  getVoiceCommandStatus,
  isVoiceCommandTerminal,
  COMMAND_ID_RE,
  TERMINAL_STATUSES
};
