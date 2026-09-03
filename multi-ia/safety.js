'use strict';
function sanitizeAdapter(adapter) { if (!adapter || typeof adapter.id !== 'string' || typeof adapter.invoke !== 'function') throw new Error('invalid adapter'); return { id:adapter.id, capabilities:Array.isArray(adapter.capabilities)?[...adapter.capabilities]:[], status:adapter.status||'unknown' }; }
function validateExternalResult(result) { if (!result || typeof result !== 'object') return {valid:false,reason:'invalid_result'}; return {valid:true}; }
module.exports = { sanitizeAdapter, validateExternalResult };
