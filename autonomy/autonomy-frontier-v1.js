'use strict';

const CATEGORIES = Object.freeze(['autonomous', 'human_gate', 'hardware_gate', 'external_authority']);
const DEFAULT_TTL_DAYS = 30;

function normalizeReason(value) {
  return String(value || '').trim().slice(0, 500);
}

function classifyRequirement(input = {}) {
  const reasons = [];
  if (input.requires_physical_device === true || input.requires_local_hardware === true || input.device_class === 'windows_local' || input.device_class === 'android_real') {
    reasons.push('physical_device_required');
    return Object.freeze({ category: 'hardware_gate', executable: false, requires: ['hardware'], reasons });
  }
  if (input.requires_human_approval === true || input.mutating_production === true || input.irreversible === true) {
    reasons.push(input.requires_human_approval === true ? 'human_approval_required' : 'protected_action');
    return Object.freeze({ category: 'human_gate', executable: false, requires: ['human'], reasons });
  }
  if (input.requires_external_authority === true || input.requires_external_credentials === true || input.third_party_authorization === true) {
    reasons.push('external_authority_required');
    return Object.freeze({ category: 'external_authority', executable: false, requires: ['external_authority'], reasons });
  }
  return Object.freeze({ category: 'autonomous', executable: true, requires: [], reasons });
}

function makePending(item = {}, { now = () => new Date().toISOString(), ttlDays = DEFAULT_TTL_DAYS } = {}) {
  if (!item.goal || typeof item.goal !== 'string') throw new TypeError('goal_required');
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 3650) throw new TypeError('ttlDays_invalid');
  const classification = classifyRequirement(item);
  if (classification.category === 'autonomous') return null;
  const createdAt = now();
  const due = new Date(new Date(createdAt).getTime() + ttlDays * 86400000).toISOString();
  return Object.freeze({
    id: `pending_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
    goal: item.goal.trim().slice(0, 500),
    category: classification.category,
    status: 'pending',
    reasons: Object.freeze(classification.reasons.map(normalizeReason)),
    created_at: createdAt,
    review_after: due,
    pc_required: classification.category === 'hardware_gate' && ['windows_local', 'android_real'].includes(item.device_class || '')
  });
}

function createAutonomyFrontier({ now = () => new Date().toISOString() } = {}) {
  const pending = new Map();

  function assess(item = {}) {
    const classification = classifyRequirement(item);
    const queueItem = classification.category === 'autonomous' ? null : makePending(item, { now });
    if (queueItem) pending.set(queueItem.id, queueItem);
    return Object.freeze({ classification, pending: queueItem });
  }

  function list({ category = null } = {}) {
    const items = [...pending.values()].filter(item => !category || item.category === category);
    return Object.freeze(items);
  }

  function close(id, reason = 'resolved') {
    const item = pending.get(id);
    if (!item) throw new Error('pending_not_found');
    const closed = Object.freeze({ ...item, status: 'closed', closed_at: now(), close_reason: normalizeReason(reason) });
    pending.set(id, closed);
    return closed;
  }

  return Object.freeze({ version: 'autonomy-frontier-v1.0', assess, list, close });
}

module.exports = Object.freeze({ CATEGORIES, classifyRequirement, makePending, createAutonomyFrontier });
