'use strict';

const { redact } = require('./redaction');

function sanitizeHeaders(headers = {}) {
  const blocked = /authorization|api[-_]?key|token|secret|password|cookie|set-cookie/i;
  const out = {};
  for (const [key, value] of Object.entries(headers)) out[key] = blocked.test(key) ? '[redacted]' : value;
  return out;
}

async function request({ url, method='GET', headers={}, body, rawBody, fetchImpl=globalThis.fetch, timeout_ms=30000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  if (body !== undefined && rawBody !== undefined) throw new Error('body_conflict');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout_ms) : null;
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : (body == null ? undefined : JSON.stringify(body)),
      signal: controller ? controller.signal : undefined
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text ? { raw: text.slice(0, 20000) } : null; }
    return { ok: response.ok, status: response.status, data: redact(data), diagnostics:{ method, url, headers:sanitizeHeaders(headers) } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { request, sanitizeHeaders };
