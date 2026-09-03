'use strict';
function createAdapterRegistry() { const map = new Map(); return { register(adapter) { if (!adapter || typeof adapter.id !== 'string' || typeof adapter.invoke !== 'function') throw new Error('invalid adapter'); map.set(adapter.id, Object.freeze({ ...adapter })); return map.get(adapter.id); }, get(id) { return map.get(id) || null; }, list() { return [...map.values()].map(a => ({ id:a.id, capabilities:a.capabilities || [], status:a.status || 'unknown' })); } }; }
module.exports = { createAdapterRegistry };
