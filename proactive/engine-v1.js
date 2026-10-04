'use strict';

const crypto = require('node:crypto');

const VERSION = 'aria-proactive-intelligence-v1.0.0';
const ACTION_MODE = 'recommendation_only';
const PRIORITY_WEIGHT = Object.freeze({ urgent: 0, high: 1, normal: 2, low: 3 });
const STATUS = new Set(['online', 'offline', 'stale', 'degraded', 'available', 'unavailable', 'blocked', 'failed', 'unknown']);
const RESOURCE_BAD = new Set(['degraded', 'unavailable', 'blocked', 'failed']);

function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStatus(value) {
  const status = stringOrNull(value)?.toLowerCase() || 'unknown';
  return STATUS.has(status) ? status : 'unknown';
}

function makeRecommendation({ kind, priority, title, reason, nextAction, sourceRefs = [], fields = {} }) {
  const fingerprint = sha256({ version: VERSION, kind, fields }).slice(0, 24);
  return Object.freeze({
    id: 'proactive_' + fingerprint,
    version: VERSION,
    action_mode: ACTION_MODE,
    kind,
    priority,
    title,
    reason,
    next_action: nextAction,
    source_refs: Object.freeze([...new Set(sourceRefs.filter(Boolean).map(String))]),
    fingerprint
  });
}

function dedupeRecommendations(recommendations) {
  const seen = new Set();
  const output = [];
  for (const recommendation of recommendations) {
    if (seen.has(recommendation.fingerprint)) continue;
    seen.add(recommendation.fingerprint);
    output.push(recommendation);
  }
  return output.sort((a, b) =>
    PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
      || a.kind.localeCompare(b.kind)
      || a.id.localeCompare(b.id)
  );
}

function analyzeDevices(snapshot, nowMs) {
  const recommendations = [];
  for (const device of Array.isArray(snapshot.devices) ? snapshot.devices : []) {
    const deviceId = stringOrNull(device?.id || device?.device_id);
    if (!deviceId) continue;
    const status = normalizeStatus(device.status);
    const activeWork = Math.max(0, numberOrNull(device.active_work) ?? numberOrNull(device.queued_work) ?? 0);
    const heartbeatMs = parseTimestamp(device.last_heartbeat_at ?? device.heartbeat_at);
    const staleAfterMs = Math.max(1000, numberOrNull(device.stale_after_ms) ?? 120000);
    const heartbeatStale = heartbeatMs !== null && nowMs - heartbeatMs > staleAfterMs;

    if ((status === 'offline' || status === 'stale' || heartbeatStale) && activeWork > 0) {
      const observed = status === 'offline' ? 'offline' : heartbeatStale ? 'stale_heartbeat' : status;
      recommendations.push(makeRecommendation({
        kind: 'device_attention',
        priority: status === 'offline' ? 'high' : 'normal',
        title: 'Revisar executor de dispositivo',
        reason: `El dispositivo ${deviceId} tiene trabajo asociado pero su estado observado es ${observed}.`,
        nextAction: 'Verificar heartbeat/estado del dispositivo antes de asignarle trabajo adicional.',
        sourceRefs: [deviceId, device.evidence_ref],
        fields: { device_id: deviceId, observed, active_work: activeWork }
      }));
    }
  }
  return recommendations;
}

function analyzeQueue(snapshot) {
  const queued = Math.max(0, numberOrNull(snapshot.queue?.queued_jobs) ?? numberOrNull(snapshot.queue?.queued) ?? 0);
  const eligible = numberOrNull(snapshot.queue?.eligible_online_executors);
  const online = numberOrNull(snapshot.queue?.online_executors);
  if (queued <= 0 || (eligible !== null && eligible > 0) || (eligible === null && online !== null && online > 0)) return [];

  return [makeRecommendation({
    kind: 'queue_blocked',
    priority: 'high',
    title: 'Hay trabajo en cola sin executor elegible',
    reason: `${queued} trabajo(s) están encolados y no hay evidencia de un executor online elegible.`,
    nextAction: 'Identificar un executor realmente disponible o dejar la cola en espera; no asumir disponibilidad.',
    sourceRefs: [snapshot.queue?.evidence_ref],
    fields: { queued_jobs: queued, eligible_online_executors: eligible, online_executors: online }
  })];
}

function analyzeResources(snapshot) {
  const recommendations = [];
  for (const resource of Array.isArray(snapshot.resources) ? snapshot.resources : []) {
    const resourceId = stringOrNull(resource?.id || resource?.resource_id || resource?.model_id || resource?.provider_id);
    if (!resourceId) continue;
    const status = normalizeStatus(resource.status);
    if (!RESOURCE_BAD.has(status)) continue;

    recommendations.push(makeRecommendation({
      kind: 'resource_degraded',
      priority: status === 'failed' || status === 'blocked' ? 'high' : 'normal',
      title: 'Revisar recurso degradado o no disponible',
      reason: `El recurso ${resourceId} está observado como ${status}; no debe tratarse como disponible.`,
      nextAction: 'Obtener evidencia nueva del recurso antes de considerarlo apto para selección.',
      sourceRefs: [resourceId, resource.evidence_ref || resource.source_ref],
      fields: {
        resource_id: resourceId,
        status,
        live_verified: resource.live_verified === true,
        verification_status: stringOrNull(resource.verification_status)
      }
    }));
  }
  return recommendations;
}

function analyzeEvidence(snapshot, nowMs) {
  const recommendations = [];
  for (const evidence of Array.isArray(snapshot.evidence) ? snapshot.evidence : []) {
    const evidenceId = stringOrNull(evidence?.id || evidence?.evidence_id);
    const observedMs = parseTimestamp(evidence?.observed_at);
    const maxAgeMs = Math.max(1000, numberOrNull(evidence?.max_age_ms) ?? 86400000);
    const verification = stringOrNull(evidence?.verification_status)?.toLowerCase() || 'unknown';
    if (!evidenceId || observedMs === null || verification !== 'verified') continue;
    if (nowMs - observedMs <= maxAgeMs) continue;

    recommendations.push(makeRecommendation({
      kind: 'evidence_stale',
      priority: 'normal',
      title: 'La evidencia operativa está vencida',
      reason: `La evidencia ${evidenceId} supera su ventana de frescura y ya no debe usarse como prueba actual.`,
      nextAction: 'Solicitar una verificación nueva antes de reutilizar esa afirmación operacional.',
      sourceRefs: [evidenceId, evidence.scope],
      fields: { evidence_id: evidenceId, observed_at: new Date(observedMs).toISOString(), max_age_ms: maxAgeMs }
    }));
  }
  return recommendations;
}

function analyzeRuntime(snapshot) {
  const expected = stringOrNull(snapshot.runtime?.expected_version);
  const observed = Array.isArray(snapshot.runtime?.observed_versions)
    ? snapshot.runtime.observed_versions.filter(Boolean).map(String).sort()
    : [];
  if (!expected || observed.length === 0 || observed.includes(expected)) return [];

  return [makeRecommendation({
    kind: 'runtime_drift',
    priority: 'normal',
    title: 'Existe deriva de versión de runtime',
    reason: `Se espera ${expected}, pero las versiones observadas no incluyen esa versión.`,
    nextAction: 'Verificar qué runtime está realmente activo antes de interpretar resultados o desplegar cambios.',
    sourceRefs: observed,
    fields: { expected, observed }
  })];
}

function analyzeDiagnostics(snapshot) {
  const recommendations = [];
  for (const diagnostic of Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : []) {
    const diagnosticId = stringOrNull(diagnostic?.id || diagnostic?.diagnostic_id);
    const severity = stringOrNull(diagnostic?.severity)?.toLowerCase() || 'info';
    const status = normalizeStatus(diagnostic?.status);
    if (!diagnosticId || !['critical', 'error'].includes(severity) || !RESOURCE_BAD.has(status)) continue;

    recommendations.push(makeRecommendation({
      kind: 'diagnostic_attention',
      priority: severity === 'critical' ? 'urgent' : 'high',
      title: 'Existe un diagnóstico operativo sin resolver',
      reason: `El diagnóstico ${diagnosticId} está marcado como ${severity}/${status}.`,
      nextAction: 'Revisar la causa raíz y la evidencia asociada antes de realizar acciones correctivas.',
      sourceRefs: [diagnosticId, diagnostic.correlation_id],
      fields: { diagnostic_id: diagnosticId, severity, status }
    }));
  }
  return recommendations;
}

function analyzeProactiveSnapshot(snapshot = {}, options = {}) {
  const nowMs = parseTimestamp(options.now) ?? Date.now();
  const normalized = snapshot && typeof snapshot === 'object' ? snapshot : {};

  const recommendations = dedupeRecommendations([
    ...analyzeDevices(normalized, nowMs),
    ...analyzeQueue(normalized),
    ...analyzeResources(normalized),
    ...analyzeEvidence(normalized, nowMs),
    ...analyzeRuntime(normalized),
    ...analyzeDiagnostics(normalized)
  ]);

  return Object.freeze({
    version: VERSION,
    action_mode: ACTION_MODE,
    generated_at: new Date(nowMs).toISOString(),
    status: recommendations.length ? 'attention' : 'quiet',
    recommendation_count: recommendations.length,
    urgent_count: recommendations.filter((item) => item.priority === 'urgent').length,
    high_count: recommendations.filter((item) => item.priority === 'high').length,
    normal_count: recommendations.filter((item) => item.priority === 'normal').length,
    low_count: recommendations.filter((item) => item.priority === 'low').length,
    fingerprints: Object.freeze(recommendations.map((item) => item.fingerprint)),
    recommendations: Object.freeze(recommendations)
  });
}

function buildProactiveDigest(snapshot = {}, options = {}) {
  return analyzeProactiveSnapshot(snapshot, options);
}

module.exports = Object.freeze({
  VERSION,
  ACTION_MODE,
  analyzeProactiveSnapshot,
  buildProactiveDigest,
  canonical,
  sha256
});
