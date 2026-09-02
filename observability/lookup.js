/**
 * ARIA Observability helpers (Mission 10.10)
 * Pure functions. Observation only. No memory authority. No routing authority.
 * Canonical contract: MISIÓN 10.10 — Observability / Telemetry Design
 */
const crypto = require('crypto');
const registry = require('./registry.json');

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /\bsk-[A-Za-z0-9_\-]{8,}/g,
  /\bor-v1-[A-Za-z0-9_\-]{8,}/g,
  /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi
];

function redact(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  let out = value;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

function newId(prefix) {
  return (prefix || 'evt') + '_' + crypto.randomBytes(8).toString('hex');
}

function createEvent(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const event = {
    event_id: p.event_id || newId('evt'),
    request_id: p.request_id || null,
    trace_id: p.trace_id || null,
    span_id: p.span_id || null,
    stage: p.stage || 'unknown',
    status: p.status || 'unknown',
    task_id: p.task_id || null,
    execution_id: p.execution_id || null,
    router_decision_id: p.router_decision_id || null,
    fallback_decision_id: p.fallback_decision_id || null,
    provider_id: p.provider_id || null,
    upstream_provider_id: p.upstream_provider_id || null,
    account_id: p.account_id || null,
    model_id: p.model_id || null,
    capability_id: p.capability_id || null,
    outcome: p.outcome || null,
    timestamp: p.timestamp || new Date().toISOString(),
    duration_ms: typeof p.duration_ms === 'number' ? p.duration_ms : null,
    usage: p.usage && typeof p.usage === 'object' ? p.usage : null,
    error_code: p.error_code || null,
    metadata: p.metadata && typeof p.metadata === 'object' ? p.metadata : {}
  };
  if (event.error_code) event.error_code = redact(String(event.error_code));
  return event;
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { ok: false, reason: 'event_missing' };
  }
  if (!event.event_id || typeof event.event_id !== 'string') {
    return { ok: false, reason: 'event_id_missing' };
  }
  // Required by canonical 10.10 contract for correlation identity
  if (event.trace_id != null && typeof event.trace_id !== 'string') {
    return { ok: false, reason: 'trace_id_invalid' };
  }
  if (event.span_id != null && typeof event.span_id !== 'string') {
    return { ok: false, reason: 'span_id_invalid' };
  }
  if (!event.timestamp || typeof event.timestamp !== 'string') {
    return { ok: false, reason: 'timestamp_missing' };
  }
  if (registry.stages.indexOf(event.stage) === -1 && event.stage !== 'unknown') {
    return { ok: false, reason: 'stage_invalid' };
  }
  if (registry.statuses.indexOf(event.status) === -1) {
    return { ok: false, reason: 'status_invalid' };
  }
  // usage / duration_ms: absence is null, never coerced to zero
  if (event.duration_ms !== null && typeof event.duration_ms !== 'number') {
    return { ok: false, reason: 'duration_ms_invalid' };
  }
  const raw = JSON.stringify(event);
  for (const re of SECRET_PATTERNS) {
    if (re.test(raw)) return { ok: false, reason: 'secret_detected' };
  }
  return { ok: true };
}

function emitSafe(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try {
    const v = validateEvent(event);
    if (!v.ok) {
      onEvent(createEvent({
        stage: 'result',
        status: 'failed',
        error_code: 'telemetry_invalid',
        metadata: { reason: v.reason }
      }));
      return;
    }
    onEvent(event);
  } catch (e) {
    /* observability must never affect execution */
  }
}

module.exports = {
  version: registry.version,
  createEvent,
  validateEvent,
  redact,
  emitSafe,
  registry
};
