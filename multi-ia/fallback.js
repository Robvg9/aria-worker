'use strict';
async function invokeWithFallback(adapters, envelope) { const errors=[]; for (const adapter of adapters) { try { return { adapter: adapter.id, response: await adapter.invoke(envelope), attempts: errors.length + 1 }; } catch (e) { errors.push({ provider:adapter.id, error:String(e && e.message || e) }); } } return { adapter:null, response:null, attempts:adapters.length, errors }; }
module.exports = { invokeWithFallback };
