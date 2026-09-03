'use strict';
function normalizeResponse(provider, raw) { return { provider: String(provider), status: raw && raw.error ? 'error' : 'success', output: raw && raw.output !== undefined ? raw.output : raw, error: raw && raw.error ? String(raw.error) : null }; }
module.exports = { normalizeResponse };
