'use strict';

const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const DEFAULT_TIMEOUT_MS = 5000;

function validateTarget(target) {
  if (!target || typeof target !== 'object') return { valid: false, reason: 'target_invalid' };
  let url;
  try { url = new URL(target.url); } catch { return { valid: false, reason: 'url_invalid' }; }
  if (url.protocol !== 'https:') return { valid: false, reason: 'https_required' };
  if (!ALLOWED_METHODS.has(target.method ?? 'GET')) return { valid: false, reason: 'method_not_allowed' };
  return { valid: true, url: url.toString(), method: target.method ?? 'GET' };
}

function normalizeStatus(status) {
  if (status >= 200 && status < 400) return { health_status: 'healthy', availability_status: 'available' };
  if (status >= 500) return { health_status: 'unavailable', availability_status: 'unavailable' };
  if (status >= 400) return { health_status: 'degraded', availability_status: 'unavailable' };
  return { health_status: 'unknown', availability_status: 'unknown' };
}

async function probeHttp(target, options = {}) {
  const check = validateTarget(target);
  if (!check.valid) return { ok: false, error: check.reason };
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch_unavailable' };

  const timeoutMs = Number.isFinite(options.timeout_ms) && options.timeout_ms > 0
    ? Math.min(options.timeout_ms, 15000)
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const observedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(check.url, {
      method: check.method,
      redirect: 'manual',
      signal: controller.signal
    });
    const mapped = normalizeStatus(response.status);
    return {
      ok: true,
      health_status: mapped.health_status,
      availability_status: mapped.availability_status,
      observed_at: observedAt,
      source: 'http_probe',
      evidence_ref: `http:${new URL(check.url).host}`,
      status_code: response.status
    };
  } catch (error) {
    const message = error && error.name === 'AbortError' ? 'probe_timeout' : 'probe_transport_error';
    return {
      ok: false,
      health_status: 'unknown',
      availability_status: 'unknown',
      observed_at: observedAt,
      source: 'http_probe',
      evidence_ref: `http:${new URL(check.url).host}`,
      error: message
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { validateTarget, normalizeStatus, probeHttp };
