'use strict';

const DEVICE_JOB_OPERATIONS = Object.freeze({
  SHELL_EXECUTE: 'shell.execute',
  OLLAMA_QWEN3: 'ollama.qwen3',
  COMPUTER_USE: 'computer.use'
});

const OLLAMA_QWEN3_MODEL = 'qwen3:4b';
const OLLAMA_QWEN3_ALLOWED_FIELDS = new Set(['prompt', 'model', 'timeout_ms']);
const COMPUTER_USE_ACTIONS = new Set(['screenshot', 'observe', 'open', 'click', 'type', 'keypress', 'scroll', 'focus']);

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

  if (operation === DEVICE_JOB_OPERATIONS.COMPUTER_USE) {
    if (typeof command !== 'string' || command.trim().length === 0) return { ok: false, error: 'computer.use payload required' };
    let payload;
    try { payload = JSON.parse(command); } catch { return { ok: false, error: 'computer.use payload must be valid JSON' }; }
    if (!isPlainObject(payload)) return { ok: false, error: 'computer.use payload must be an object' };
    if (typeof payload.action !== 'string' || !COMPUTER_USE_ACTIONS.has(payload.action)) return { ok: false, error: 'computer.use action unsupported' };
    if (payload.action === 'type' && (typeof payload.text !== 'string' || payload.text.length === 0 || payload.text.length > 32768)) return { ok: false, error: 'computer.use text invalid' };
    if (payload.action === 'click' && (!Number.isInteger(payload.x) || !Number.isInteger(payload.y))) return { ok: false, error: 'computer.use click coordinates invalid' };
    if (payload.action === 'keypress' && (typeof payload.key !== 'string' || !payload.key.trim())) return { ok: false, error: 'computer.use key invalid' };
    if (payload.action === 'scroll' && !Number.isInteger(payload.delta)) return { ok: false, error: 'computer.use scroll delta invalid' };
    if (payload.action === 'open' && (typeof payload.path !== 'string' || !payload.path.trim())) return { ok: false, error: 'computer.use path invalid' };
    if (payload.action === 'focus' && (typeof payload.process !== 'string' || !payload.process.trim())) return { ok: false, error: 'computer.use process invalid' };
    return { ok: true, payload };
  }

  return { ok: false, error: 'unsupported operation' };
}

module.exports = Object.freeze({ DEVICE_JOB_OPERATIONS, OLLAMA_QWEN3_MODEL, COMPUTER_USE_ACTIONS, validateDeviceJobOperation });
