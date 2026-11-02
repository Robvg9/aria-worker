'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = new Set(['device_unavailable','permission_denied','operation_unsupported','app_not_allowlisted','url_not_allowlisted','native_api_failed','command_expired','command_cancelled','device_busy']);

function parseAllowlist(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return new Set(values.map(item => String(item).trim().toLowerCase()).filter(Boolean));
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function hostAllowed(hostname, allowedHosts) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  for (const raw of allowedHosts || []) {
    const allowed = String(raw).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (allowed && (host === allowed || host.endsWith('.' + allowed))) return true;
  }
  return false;
}

function validateVoiceDeviceCommand(command, options = {}) {
  const deviceId = String(options.deviceId || '');
  const now = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw fail('operation_unsupported');
  if (!UUID_RE.test(String(command.command_id || ''))) throw fail('operation_unsupported');
  if (!deviceId || command.device_id !== deviceId) throw fail('device_unavailable');
  if (!UUID_RE.test(String(command.source_device_id || ''))) throw fail('device_unavailable');
  if (command.status !== 'claimed') throw fail('device_unavailable');

  const expiry = Date.parse(String(command.expires_at || ''));
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 30_000) throw fail('command_expired');

  const params = command.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw fail('operation_unsupported');
  const keys = Object.keys(params);
  const oneKey = expected => keys.length === 1 && keys[0] === expected;

  if (command.operation === 'display.brightness.set') {
    if (!oneKey('brightness') || !Number.isInteger(params.brightness)
        || params.brightness < 0 || params.brightness > 100) throw fail('operation_unsupported');
    return Object.freeze({ commandId: command.command_id, operation: command.operation, params: Object.freeze({ brightness: params.brightness }) });
  }

  if (command.operation === 'app.open') {
    if (!oneKey('app_id') || typeof params.app_id !== 'string'
        || !/^[A-Za-z0-9._-]{1,120}$/.test(params.app_id)) throw fail('operation_unsupported');
    const allowedApps = options.allowedApps instanceof Set ? options.allowedApps : parseAllowlist(options.allowedApps);
    if (!allowedApps.has(params.app_id.toLowerCase())) throw fail('app_not_allowlisted');
    return Object.freeze({ commandId: command.command_id, operation: command.operation, params: Object.freeze({ app_id: params.app_id }) });
  }

  if (command.operation === 'browser.open_url') {
    if (!oneKey('url') || typeof params.url !== 'string' || params.url.length > 2048) throw fail('operation_unsupported');
    let url;
    try { url = new URL(params.url); } catch { throw fail('url_not_allowlisted'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
        || url.hostname === '127.0.0.1' || url.hostname === '::1') throw fail('url_not_allowlisted');
    const allowedUrlHosts = options.allowedUrlHosts instanceof Set ? options.allowedUrlHosts : parseAllowlist(options.allowedUrlHosts);
    if (!hostAllowed(url.hostname, allowedUrlHosts)) throw fail('url_not_allowlisted');
    return Object.freeze({ commandId: command.command_id, operation: command.operation, params: Object.freeze({ url: url.href }) });
  }

  throw fail('operation_unsupported');
}

async function executeVoiceDeviceCommand(command, options = {}) {
  try {
    const validated = validateVoiceDeviceCommand(command, options);
    const adapters = options.adapters || {};
    let result;
    if (validated.operation === 'display.brightness.set') {
      if (typeof adapters.setBrightness !== 'function') throw fail('operation_unsupported');
      await adapters.setBrightness(validated.params.brightness);
      result = { ok: true, brightness: validated.params.brightness };
    } else if (validated.operation === 'app.open') {
      if (typeof adapters.openApp !== 'function') throw fail('operation_unsupported');
      await adapters.openApp(validated.params.app_id);
      result = { ok: true, app_id: validated.params.app_id, opened: true };
    } else if (validated.operation === 'browser.open_url') {
      if (typeof adapters.openUrl !== 'function') throw fail('operation_unsupported');
      await adapters.openUrl(validated.params.url);
      result = { ok: true, opened: true };
    } else throw fail('operation_unsupported');
    return { status: 'succeeded', result, errorCode: null };
  } catch (error) {
    const code = ERROR_CODES.has(error?.code) ? error.code : 'native_api_failed';
    return { status: 'failed', result: { ok: false }, errorCode: code };
  }
}

module.exports = { ERROR_CODES, UUID_RE, executeVoiceDeviceCommand, hostAllowed, parseAllowlist, validateVoiceDeviceCommand };
