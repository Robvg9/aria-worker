'use strict';

const assert = require('assert');
const { DEVICE_JOB_OPERATIONS, OLLAMA_QWEN3_MODEL, validateDeviceJobOperation } = require('../execution/device-job-contract');

const validQwen = JSON.stringify({ prompt: 'Responde exactamente: QWEN_ARIA_OK', model: OLLAMA_QWEN3_MODEL });

assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.SHELL_EXECUTE, 'echo ok').ok, true);
assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, validQwen).ok, true);
assert.strictEqual(validateDeviceJobOperation('unknown.operation', '{}').ok, false);
assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, JSON.stringify({ model: OLLAMA_QWEN3_MODEL })).ok, false);
assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, JSON.stringify({ prompt: 'ok', model: 'qwen3:8b' })).ok, false);
assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, JSON.stringify({ prompt: 'ok', extra: 'shell' })).ok, false);
assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, 'not-json').ok, false);
assert.strictEqual(validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, JSON.stringify({ prompt: 'ok', timeout_ms: 999 })).ok, false);

const normalized = validateDeviceJobOperation(DEVICE_JOB_OPERATIONS.OLLAMA_QWEN3, JSON.stringify({ prompt: 'ok' }));
assert.strictEqual(normalized.payload.model, OLLAMA_QWEN3_MODEL);

console.log('device job contract tests passed');
