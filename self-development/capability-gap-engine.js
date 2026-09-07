'use strict';

const VALID_STATUS = new Set(['verified', 'available', 'active', 'unknown', 'unavailable', 'deprecated', 'blocked']);
const PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

function normalizeCapability(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id.trim();
  return '';
}

function normalizeAvailable(input = []) {
  const out = new Map();
  for (const item of Array.isArray(input) ? input : []) {
    const id = normalizeCapability(item);
    if (!id) continue;
    const status = typeof item === 'object' && VALID_STATUS.has(item.status) ? item.status : 'available';
    const evidence = typeof item === 'object' ? (item.evidence || null) : null;
    const confidence = typeof item === 'object' && Number.isFinite(item.confidence) ? item.confidence : null;
    out.set(id, { id, status, evidence, confidence });
  }
  return out;
}

function priorityForGap({ required, available, dependencyCount = 0 } = {}) {
  if (!available) return dependencyCount > 1 ? 'critical' : 'high';
  if (available.status === 'unknown') return 'high';
  if (available.status === 'blocked') return 'medium';
  if (available.status === 'deprecated') return 'medium';
  return 'low';
}

function analyzeCapabilityGaps({ goal, required = [], available = [], dependencies = {} } = {}) {
  const normalizedGoal = typeof goal === 'string' ? goal.trim() : '';
  if (!normalizedGoal) throw new TypeError('goal_required');
  if (!Array.isArray(required) || required.length === 0) throw new TypeError('required_capabilities_required');

  const availableMap = normalizeAvailable(available);
  const requiredIds = [...new Set(required.map(normalizeCapability).filter(Boolean))];
  const gaps = [];
  const satisfied = [];

  for (const capability of requiredIds) {
    const record = availableMap.get(capability);
    const verified = record && (record.status === 'verified' || record.status === 'active' || record.status === 'available');
    if (verified) {
      satisfied.push({ capability_id: capability, status: record.status, confidence: record.confidence, evidence: record.evidence });
      continue;
    }
    const deps = Array.isArray(dependencies[capability]) ? dependencies[capability].map(String) : [];
    gaps.push({
      capability_id: capability,
      status: record ? record.status : 'missing',
      priority: priorityForGap({ required: capability, available: record, dependencyCount: deps.length }),
      dependencies: deps,
      existing_evidence: record?.evidence || null,
    });
  }

  gaps.sort((a, b) => PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || a.capability_id.localeCompare(b.capability_id));
  return Object.freeze({
    status: gaps.length ? 'gaps_detected' : 'capability_ready',
    goal: normalizedGoal,
    required: Object.freeze(requiredIds),
    satisfied: Object.freeze(satisfied),
    gaps: Object.freeze(gaps),
    gap_count: gaps.length,
    engine_version: 'capability-gap-engine-v2.0.0'
  });
}

module.exports = Object.freeze({ analyzeCapabilityGaps, normalizeAvailable, normalizeCapability, PRIORITIES });
