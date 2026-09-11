'use strict';

const DEVICE_JOB_OPERATIONS = Object.freeze({
  SHELL_EXECUTE: 'shell.execute',
  OLLAMA_QWEN3: 'ollama.qwen3'
});

const OLLAMA_QWEN3_MODEL = 'qwen3:4b';
const OLLAMA_QWEN3_ALLOWED_FIELDS = new Set(['prompt', 'model', 'timeout_ms']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateDeviceJobOperation(operation, command) {
  if (operation === DEVICE_JOB_OPERATIONS.SHELL_EXECUTE) {
    if (typeof command !== 'string' || command.trim().length === 0) return { ok: false, error: 'command required' };
    return { ok: true };
  }

  if (operation === DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3) {
    if (typeof command !== 'string' || command.trim().length === 0) return { ok: false, error: 'ollama.qwen3 payload required' };
    let payload;
    try { payload = JSON.parse(command); } catch { return { ok: false, error: 'ollama.qwen3 payload must be valid JSON' }; }
    if (!isPlainObject(payload)) return { ok: false, error: 'ollama.qwen3 payload must be an object' };
    const keys = Object.keys(payload);
    if (keys.some(key => !OLLAMA_QWEN3_ALLOWED_FIELDS.has(key))) return { ok: false, error: 'ollama.qwen3 payload contains unsupported fields' };
    if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) return { ok: false, error: 'ollama.qwen3 prompt required' };
    if (payload.model !== undefined && payload.model !== OLLAMA_QWEN3_MODEL) return { ok: false, error: 'ollama.qwen3 model must be qwen3:4b' };
    if (payload.timeout_ms !== undefined && (!Number.isInteger(payload.timeout_ms) || payload.timeout_ms < 1000 || payload.timeout_ms > 3600000)) return { ok: false, error: 'ollama.qwen3 timeout_ms must be an integer between 1000 and 3600000' };
    return { ok: true, payload: { ...payload, model: OLLAMA_QWEN3_MODEL } };
  }

  return { ok: false, error: 'unsupported operation' };
}

module.exports = Object.freeze({ DEVICE_JOB_OPERATIONS, OLLAMA_QWEN3_MODEL, validateDeviceJobOperation });
