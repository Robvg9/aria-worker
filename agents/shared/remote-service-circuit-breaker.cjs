'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const CLAIM_ROUTES = new Set(['/v1/jobs/claim', '/v1/voice/commands/claim']);
const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);

function isRetryableHttpStatus(status) {
  return RETRYABLE_HTTP_STATUSES.has(Number(status)) ||
    (Number(status) >= 500 && Number(status) <= 599);
}

function parseRetryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.ceil(Number(text) * 1000));
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function classify402(payload) {
  const parts = [];
  if (typeof payload === 'string') parts.push(payload);
  if (payload && typeof payload === 'object') {
    for (const key of ['error', 'reason', 'code', 'message', 'detail', 'details', 'type']) {
      const value = payload[key];
      if (typeof value === 'string') parts.push(value);
      else if (value && typeof value === 'object') {
        for (const nested of ['code', 'message', 'reason', 'type']) {
          if (typeof value[nested] === 'string') parts.push(value[nested]);
        }
      }
    }
  }
  const text = parts.join(' ').toLowerCase();
  if (/(quota|usage[_ -]?limit|rate[_ -]?limit|limit[_ -]?(exceeded|reached)|resource[_ -]?exhausted)/i.test(text)) {
    return 'quota_exhausted';
  }
  if (/(billing|payment|invoice|subscription|insufficient[_ -]?credit|credit[_ -]?(exhausted|depleted|insufficient)|balance[_ -]?(low|empty))/i.test(text)) {
    return 'billing_restriction';
  }
  if (/(suspend|service[_ -]?(disabled|restricted|unavailable)|project[_ -]?disabled|account[_ -]?restricted|region[_ -]?restricted)/i.test(text)) {
    return 'service_restriction';
  }
  return 'unknown_402';
}

function isExpectedMissionPause(payload) {
  return Boolean(payload && typeof payload === 'object' && (
    payload.error === 'mission_execution_paused' ||
    (payload.status === 'paused' && payload.execution_enabled === false)
  ));
}

function safeRoute(route) {
  const value = typeof route === 'string' ? route.split('?')[0] : '/unknown';
  return value
    .replace(/^\/v1\/jobs\/[^/]+\/(start|progress|result|status|resolve-secret)$/, '/v1/jobs/:id/$1')
    .slice(0, 120);
}

function emptyState() {
  return { version: 1, service_circuit: null, paused_routes: {} };
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 ||
      (value.paused_routes !== undefined && (!value.paused_routes || typeof value.paused_routes !== 'object' || Array.isArray(value.paused_routes)))) {
    throw new Error('circuit_state_invalid');
  }
  const state = emptyState();
  if (value.service_circuit && value.service_circuit.open === true) {
    state.service_circuit = {
      open: true,
      status: 402,
      classification: typeof value.service_circuit.classification === 'string' ? value.service_circuit.classification : 'unknown_402',
      route: safeRoute(value.service_circuit.route),
      opened_at: typeof value.service_circuit.opened_at === 'string' ? value.service_circuit.opened_at : null,
      incident_id: typeof value.service_circuit.incident_id === 'string' ? value.service_circuit.incident_id : 'unknown',
      alert_emitted: value.service_circuit.alert_emitted === true,
      global: value.service_circuit.global === true,
      global_incident_id: typeof value.service_circuit.global_incident_id === 'string' ? value.service_circuit.global_incident_id : null
    };
  }
  for (const route of Object.keys(value.paused_routes || {})) {
    const item = value.paused_routes[route];
    if (CLAIM_ROUTES.has(route) && item && item.status === 423 && item.reason === 'mission_execution_paused') {
      state.paused_routes[route] = {
        status: 423,
        reason: 'mission_execution_paused',
        paused_at: typeof item.paused_at === 'string' ? item.paused_at : null,
        incident_id: typeof item.incident_id === 'string' ? item.incident_id : 'unknown',
        alert_emitted: item.alert_emitted === true
      };
    }
  }
  return state;
}

function resolveDefaultStatePath() {
  const configured = process.env.ARIA_AGENT_STATE_DIR;
  const root = configured && configured.trim()
    ? configured
    : path.join(os.homedir(), '.aria', 'state');
  return path.join(root, 'remote-service-circuit.json');
}

async function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createRemoteServiceCircuitBreaker(options = {}) {
  const statePath = options.statePath || resolveDefaultStatePath();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => crypto.randomUUID();
  const onIncident = typeof options.onIncident === 'function' ? options.onIncident : () => {};
  const retryAfterUntil = new Map();
  let readyPromise = null;
  let memoryBlocked = null;

  async function readState() {
    let raw;
    try {
      raw = await fs.readFile(statePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: emptyState(), missing: true };
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('circuit_state_corrupt');
    }
    return { state: normalizeState(parsed), missing: false };
  }

  async function writeState(state) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const temporary = statePath + '.' + process.pid + '.' + idFactory() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temporary, statePath);
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async function withLock(callback) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const lockPath = statePath + '.lock';
    const started = Date.now();
    let handle = null;
    while (Date.now() - started < 3_000) {
      try {
        handle = await fs.open(lockPath, 'wx', 0o600);
        break;
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lockPath);
          if (Date.now() - stat.mtimeMs > 15_000) await fs.unlink(lockPath);
        } catch {}
        await pause(20);
      }
    }
    if (!handle) throw new Error('circuit_state_lock_unavailable');
    try {
      return await callback();
    } finally {
      await handle.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    }
  }

  async function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          await withLock(async () => {
            const current = await readState();
            if (current.missing) await writeState(current.state);
          });
        } catch (error) {
          memoryBlocked = {
            code: 'circuit_state_unavailable',
            reason: error && error.message === 'circuit_state_corrupt' ? 'circuit_state_corrupt' : 'circuit_state_persist_failed'
          };
        }
      })();
    }
    await readyPromise;
    return !memoryBlocked;
  }

  async function beforeRequest(route) {
    await ready();
    if (memoryBlocked) {
      return { allowed: false, kind: 'state_unavailable', code: memoryBlocked.code, reason: memoryBlocked.reason };
    }
    let current;
    try {
      current = (await readState()).state;
    } catch (error) {
      memoryBlocked = {
        code: 'circuit_state_unavailable',
        reason: error && error.message === 'circuit_state_corrupt' ? 'circuit_state_corrupt' : 'circuit_state_read_failed'
      };
      return { allowed: false, kind: 'state_unavailable', code: memoryBlocked.code, reason: memoryBlocked.reason };
    }
    if (current.service_circuit) {
      return {
        allowed: false,
        kind: 'service_circuit_open',
        code: 'gateway_402_circuit_open',
        status: 402,
        classification: current.service_circuit.classification,
        incident_id: current.service_circuit.incident_id
      };
    }
    if (current.paused_routes[route]) {
      return {
        allowed: false,
        kind: 'route_paused',
        code: 'mission_execution_paused',
        status: 423,
        reason: current.paused_routes[route].reason
      };
    }
    const until = retryAfterUntil.get(route) || 0;
    if (until > now()) {
      return { allowed: false, kind: 'retry_after', code: 'retry_after_wait', wait_ms: until - now() };
    }
    return { allowed: true };
  }

  async function recordResponse(route, status, payload, headers) {
    const retryAfterMs = parseRetryAfterMs(getHeader(headers, 'retry-after'), now());
    if (isRetryableHttpStatus(status) && retryAfterMs !== null) {
      retryAfterUntil.set(route, now() + retryAfterMs);
    }

    if (Number(status) !== 402 && !(Number(status) === 423 && CLAIM_ROUTES.has(route) && isExpectedMissionPause(payload))) {
      return { recorded: false, retry_after_ms: retryAfterMs };
    }

    if (memoryBlocked) return { recorded: false, blocked: true, reason: memoryBlocked.reason };

    let incident = null;
    try {
      await withLock(async () => {
        const current = (await readState()).state;
        if (Number(status) === 402 && !current.service_circuit) {
          const event = {
            type: 'service_circuit_open',
            status: 402,
            classification: classify402(payload),
            route: safeRoute(route),
            incident_id: idFactory()
          };
          current.service_circuit = {
            open: true,
            status: 402,
            classification: event.classification,
            route: event.route,
            opened_at: new Date(now()).toISOString(),
            incident_id: event.incident_id,
            alert_emitted: true,
            global: false,
            global_incident_id: null
          };
          incident = event;
        } else if (Number(status) === 423 && !current.paused_routes[route]) {
          const event = {
            type: 'claim_route_paused',
            status: 423,
            classification: 'mission_execution_paused',
            route: route,
            incident_id: idFactory()
          };
          current.paused_routes[route] = {
            status: 423,
            reason: 'mission_execution_paused',
            paused_at: new Date(now()).toISOString(),
            incident_id: event.incident_id,
            alert_emitted: true
          };
          incident = event;
        }
        await writeState(current);
      });
    } catch (error) {
      memoryBlocked = { code: 'circuit_state_unavailable', reason: 'circuit_state_persist_failed' };
      return { recorded: false, blocked: true, reason: memoryBlocked.reason };
    }

    if (incident) {
      try {
        await onIncident({
          type: incident.type,
          status: incident.status,
          classification: incident.classification,
          route: safeRoute(incident.route),
          incident_id: incident.incident_id
        });
      } catch {}
    }
    return { recorded: Boolean(incident), retry_after_ms: retryAfterMs };
  }

  async function applyGlobalCircuit(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.open !== 'boolean') {
      return { applied: false, reason: 'global_circuit_state_invalid' };
    }
    if (memoryBlocked) return { applied: false, reason: memoryBlocked.reason };
    if (snapshot.open === true) {
      const circuit = snapshot.circuit;
      if (!circuit || Number(circuit.status) !== 402 ||
          typeof circuit.incident_id !== 'string' ||
          typeof circuit.classification !== 'string') {
        return { applied: false, reason: 'global_circuit_incident_invalid' };
      }
      try {
        await withLock(async () => {
          const current = (await readState()).state;
          const existing = current.service_circuit;
          if (!existing || existing.global_incident_id !== circuit.incident_id) {
            current.service_circuit = {
              open: true,
              status: 402,
              classification: circuit.classification,
              route: safeRoute(circuit.route),
              opened_at: typeof circuit.opened_at === 'string' ? circuit.opened_at : new Date(now()).toISOString(),
              incident_id: existing?.incident_id || circuit.incident_id,
              alert_emitted: true,
              global: true,
              global_incident_id: circuit.incident_id
            };
          } else {
            existing.global = true;
            existing.global_incident_id = circuit.incident_id;
          }
          await writeState(current);
        });
      } catch (error) {
        memoryBlocked = { code: 'circuit_state_unavailable', reason: 'circuit_state_persist_failed' };
        return { applied: false, reason: memoryBlocked.reason };
      }
      return { applied: true, open: true, incident_id: circuit.incident_id };
    }

    const reset = snapshot.last_reset;
    if (!reset || reset.service_restored !== true || typeof reset.incident_id !== 'string') {
      return { applied: false, reason: 'global_circuit_reset_not_authorized' };
    }
    let current;
    try {
      current = (await readState()).state;
    } catch (error) {
      memoryBlocked = { code: 'circuit_state_unavailable', reason: 'circuit_state_read_failed' };
      return { applied: false, reason: memoryBlocked.reason };
    }
    if (!current.service_circuit ||
        current.service_circuit.global !== true ||
        current.service_circuit.global_incident_id !== reset.incident_id) {
      return { applied: false, reason: 'global_circuit_reset_does_not_match_local_incident' };
    }
    try {
      await withLock(async () => {
        const latest = (await readState()).state;
        if (!latest.service_circuit ||
            latest.service_circuit.global !== true ||
            latest.service_circuit.global_incident_id !== reset.incident_id) {
          throw new Error('global_circuit_reset_does_not_match_local_incident');
        }
        latest.service_circuit = null;
        // Preserve 423 route pauses. Clearing a quota circuit must never clear
        // the canonical mission-execution freeze or route-specific pause state.
        await writeState(latest);
      });
      retryAfterUntil.clear();
      return { applied: true, open: false, reset };
    } catch (error) {
      return { applied: false, reason: error && error.message || 'global_circuit_reset_failed' };
    }
  }

  async function isOpen() {
    const result = await beforeRequest('/__aria_status_check__');
    return result.kind === 'service_circuit_open' || result.kind === 'state_unavailable';
  }

  async function isRoutePaused(route) {
    const result = await beforeRequest(route);
    return result.kind === 'route_paused';
  }

  async function resetAfterAuthorizedRecovery({ authorized, probe } = {}) {
    if (authorized !== true) throw new Error('circuit_reset_requires_explicit_authorization');
    if (typeof probe !== 'function') throw new TypeError('circuit_reset_requires_one_shot_probe');
    await ready();
    if (memoryBlocked) throw new Error('circuit_state_unavailable');
    return withLock(async () => {
      const current = (await readState()).state;
      const evidence = await probe();
      if (!evidence || evidence.serviceRestored !== true) {
        throw new Error('circuit_reset_probe_failed');
      }
      if (Object.keys(current.paused_routes).length && evidence.canonicalFreezeCleared !== true) {
        throw new Error('circuit_reset_freeze_still_active');
      }
      await writeState(emptyState());
      retryAfterUntil.clear();
      return { reset: true, probe_attempts: 1, cleared_paused_routes: Object.keys(current.paused_routes).length };
    });
  }

  return {
    ready,
    beforeRequest,
    recordResponse,
    isOpen,
    isRoutePaused,
    applyGlobalCircuit,
    resetAfterAuthorizedRecovery
  };
}

module.exports = {
  createRemoteServiceCircuitBreaker,
  classify402,
  isExpectedMissionPause,
  isRetryableHttpStatus,
  parseRetryAfterMs,
  resolveDefaultStatePath
};
