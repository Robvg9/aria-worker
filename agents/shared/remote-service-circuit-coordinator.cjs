'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const DEFAULT_COORDINATOR_URL = 'https://aria-autonomy-coordinator.robvg9.workers.dev';
const CIRCUIT_PATH = '/api/worker/service-circuit';
const ALLOWED_CLASSIFICATIONS = new Set([
  'quota_exhausted',
  'billing_restriction',
  'service_restriction',
  'unknown_402'
]);
const ALLOWED_FIXED_ROUTES = new Set([
  '/v1/devices/heartbeat',
  '/v1/devices/enroll',
  '/v1/jobs/claim',
  '/v1/voice/commands/claim'
]);
const ALLOWED_JOB_ROUTE = /^\\/v1\\/jobs\\/:id\\/(?:start|progress|result|status|resolve-secret)$/;

function isAllowedCircuitRoute(route) {
  return ALLOWED_FIXED_ROUTES.has(route) || ALLOWED_JOB_ROUTE.test(route);
}

function createRemoteServiceCircuitCoordinator(options = {}) {
  const env = options.env || process.env;
  const rawBaseUrl = options.baseUrl || env.ARIA_AUTONOMY_COORDINATOR_URL || env.ARIA_CONTROL_URL || DEFAULT_COORDINATOR_URL;
  const token = String(options.token || env.ARIA_AUTONOMY_WORKER_TOKEN || env.ARIA_WORKER_TOKEN || '').trim();
  const agent = ['windows', 'termux'].includes(options.agent) ? options.agent : 'unknown';
  const deviceIdentity = String(options.deviceId || env.ARIA_DEVICE_ID || env.ARIA_WORKER_ID || os.hostname() || 'unknown-device');
  const sourceIdSha256 = crypto.createHash('sha256').update(deviceIdentity).digest('hex');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const pollIntervalMs = Math.max(10_000, Math.min(300_000, Number(options.pollIntervalMs || env.ARIA_CIRCUIT_SYNC_INTERVAL_MS || 30_000)));
  const timeoutMs = Math.max(1_000, Math.min(10_000, Number(options.timeoutMs || 5_000)));
  let nextPollAt = 0;
  let inFlight = null;
  let lastSnapshot = null;

  let baseUrl = null;
  try {
    const parsed = new URL(String(rawBaseUrl));
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
      baseUrl = parsed.origin;
    }
  } catch {}

  const configured = Boolean(baseUrl && token.length >= 32 && typeof fetchImpl === 'function');

  async function request(method, body) {
    if (!configured) return null;
    try {
      const response = await fetchImpl(new URL(CIRCUIT_PATH, baseUrl).toString(), {
        method,
        headers: {
          authorization: 'Bearer ' + token,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error'
      });
      if (!response || !response.ok) return null;
      const payload = await response.json();
      return payload && typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  }

  async function reportIncident(event, breaker = null) {
    if (!configured) return { ok: false, reason: 'coordinator_not_configured' };
    const classification = String(event && event.classification || 'unknown_402');
    const route = String(event && event.route || '');
    const incidentId = String(event && event.incident_id || '');
    if (!ALLOWED_CLASSIFICATIONS.has(classification) ||
        !isAllowedCircuitRoute(route) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(incidentId)) {
      return { ok: false, reason: 'incident_payload_invalid' };
    }
    const payload = await request('POST', {
      incident_id: incidentId,
      classification,
      route,
      source_id_sha256: sourceIdSha256,
      agent,
      observed_at: new Date(now()).toISOString()
    });
    if (!payload || payload.open !== true || !payload.circuit) {
      return { ok: false, reason: 'coordinator_open_rejected' };
    }
    lastSnapshot = payload;
    nextPollAt = now() + pollIntervalMs;
    if (breaker && typeof breaker.applyGlobalCircuit === 'function') {
      await breaker.applyGlobalCircuit(payload);
    }
    return { ok: true, snapshot: payload };
  }

  async function sync(breaker, { force = false } = {}) {
    if (!configured) return { synced: false, reason: 'coordinator_not_configured' };
    if (!breaker || typeof breaker.applyGlobalCircuit !== 'function') {
      return { synced: false, reason: 'circuit_breaker_required' };
    }
    if (!force && now() < nextPollAt) {
      return lastSnapshot
        ? { synced: false, cached: true, snapshot: lastSnapshot }
        : { synced: false, cached: true, reason: 'poll_interval_not_elapsed' };
    }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const payload = await request('GET');
      nextPollAt = now() + pollIntervalMs;
      if (!payload || typeof payload.open !== 'boolean') {
        return { synced: false, reason: 'coordinator_unavailable' };
      }
      lastSnapshot = payload;
      const applied = await breaker.applyGlobalCircuit(payload);
      return { synced: Boolean(applied && applied.applied), snapshot: payload, applied };
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    configured,
    agent,
    sourceIdSha256,
    reportIncident,
    sync
  };
}

module.exports = {
  DEFAULT_COORDINATOR_URL,
  createRemoteServiceCircuitCoordinator,
  isAllowedCircuitRoute
};
