'use strict';
function createEnvelope(input = {}) { if (typeof input.task_id !== 'string' || !input.task_id) throw new Error('task_id required'); if (typeof input.prompt !== 'string') throw new Error('prompt required'); return Object.freeze({ version:1, task_id:input.task_id, prompt:input.prompt, capabilities:Array.isArray(input.capabilities)?[...input.capabilities]:[], metadata: input.metadata ? { ...input.metadata } : {} }); }
module.exports = { createEnvelope };
