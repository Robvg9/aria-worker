'use strict';

const CATEGORIES = Object.freeze(['autonomous', 'human_gate', 'hardware_gate', 'external_authority']);

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

function createAutonomyFrontier() {
  const pending = new Map();

  function assess(item = {}) {
    const classification = classifyRequirement(item);
    if (classification.category === 'autonomous') return Object.freeze({ classification, pending: null });
    const id = `pending_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
    const record = Object.freeze({
      id,
      goal: String(item.goal || '').trim().slice(0, 500),
      category: classification.category,
      status: 'pending',
      reasons: Object.freeze(classification.reasons.map(normalizeReason)),
      created_at: new Date().toISOString()
    });
    pending.set(id, record);
    return Object.freeze({ classification, pending: record });
  }

  function list({ category = null } = {}) {
    return Object.freeze([...pending.values()].filter(item => !category || item.category === category));
  }

  function close(id, reason = 'resolved') {
    const item = pending.get(id);
    if (!item) throw new Error('pending_not_found');
    const closed = Object.freeze({ ...item, status: 'closed', closed_at: new Date().toISOString(), close_reason: normalizeReason(reason) });
    pending.set(id, closed);
    return closed;
  }

  return Object.freeze({ version: 'autonomy-frontier-v1.0', assess, list, close });
}

module.exports = Object.freeze({ CATEGORIES, classifyRequirement, createAutonomyFrontier });
