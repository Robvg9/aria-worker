'use strict';

const assert = require('node:assert/strict');
const { executeVoiceDeviceCommand, validateVoiceDeviceCommand } = require('../agents/shared/voice-command-executor.cjs');

const DEVICE = 'device-android-01';
const SOURCE = '123e4567-e89b-42d3-a456-426614174001';
const NOW = Date.parse('2026-11-02T23:30:00.000Z');
const ID = '123e4567-e89b-42d3-a456-426614174000';

function command(overrides = {}) {
  return {
    command_id: ID,
    device_id: DEVICE,
    source_device_id: SOURCE,
    operation: 'display.brightness.set',
    params: { brightness: 72 },
    status: 'claimed',
    expires_at: new Date(NOW + 20_000).toISOString(),
    ...overrides
  };
}

(async () => {
  const realDeviceId = command({ source_device_id: 'a16-de-roberto-carlos' });
  assert.equal(validateVoiceDeviceCommand(realDeviceId, { deviceId: DEVICE, nowMs: NOW }).operation, 'display.brightness.set',
    'device registry IDs are text identifiers and are not required to be UUIDs');
  const valid = validateVoiceDeviceCommand(command(), { deviceId: DEVICE, nowMs: NOW });
  assert.equal(valid.operation, 'display.brightness.set');
  assert.deepEqual(valid.params, { brightness: 72 });

  const calls = [];
  const executed = await executeVoiceDeviceCommand(command(), {
    deviceId: DEVICE, nowMs: NOW, adapters: { setBrightness: async value => calls.push(value) }
  });
  assert.equal(executed.status, 'succeeded');
  assert.deepEqual(executed.result, { ok: true, brightness: 72 });
  assert.deepEqual(calls, [72]);

  const app = await executeVoiceDeviceCommand(command({ operation: 'app.open', params: { app_id: 'chrome' } }), {
    deviceId: DEVICE, nowMs: NOW, allowedApps: ['chrome'], adapters: { openApp: async value => calls.push(value) }
  });
  assert.equal(app.status, 'succeeded');
  assert.deepEqual(app.result, { ok: true, app_id: 'chrome', opened: true });

  const url = 'https://github.com/Robvg9/aria-worker';
  const opened = [];
  const urlResult = await executeVoiceDeviceCommand(command({ operation: 'browser.open_url', params: { url } }), {
    deviceId: DEVICE, nowMs: NOW, allowedUrlHosts: ['github.com'], adapters: { openUrl: async value => opened.push(value) }
  });
  assert.equal(urlResult.status, 'succeeded');
  assert.deepEqual(urlResult.result, { ok: true, opened: true });
  assert.deepEqual(opened, [url]);

  for (const [input, expected] of [
    [command({ device_id: 'device-other-99' }), 'device_unavailable'],
    [command({ status: 'queued' }), 'device_unavailable'],
    [command({ expires_at: new Date(NOW - 1).toISOString() }), 'command_expired'],
    [command({ expires_at: new Date(NOW + 31_000).toISOString() }), 'command_expired'],
    [command({ params: { brightness: 101 } }), 'operation_unsupported'],
    [command({ operation: 'shell.execute', params: { command: 'whoami' } }), 'operation_unsupported']
  ]) {
    const result = await executeVoiceDeviceCommand(input, { deviceId: DEVICE, nowMs: NOW });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, expected);
  }

  const deniedApp = await executeVoiceDeviceCommand(command({ operation: 'app.open', params: { app_id: 'chrome' } }), {
    deviceId: DEVICE, nowMs: NOW, allowedApps: ['notepad'], adapters: { openApp: async () => { throw new Error('must not run'); } }
  });
  assert.equal(deniedApp.errorCode, 'app_not_allowlisted');

  for (const badUrl of ['http://github.com', 'javascript:alert(1)', 'https://user:pass@github.com', 'https://github.com.evil.example']) {
    const result = await executeVoiceDeviceCommand(command({ operation: 'browser.open_url', params: { url: badUrl } }), {
      deviceId: DEVICE, nowMs: NOW, allowedUrlHosts: ['github.com'], adapters: { openUrl: async () => {} }
    });
    assert.equal(result.errorCode, 'url_not_allowlisted');
  }

  const failedNative = await executeVoiceDeviceCommand(command(), {
    deviceId: DEVICE, nowMs: NOW,
    adapters: { setBrightness: async () => { const error = new Error('permission'); error.code = 'permission_denied'; throw error; } }
  });
  assert.equal(failedNative.status, 'failed');
  assert.equal(failedNative.errorCode, 'permission_denied');

  console.log('ARIA Voice V4 device-agent command contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
