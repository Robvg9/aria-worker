'use strict';

const STATES = Object.freeze(['pending', 'approved', 'rejected', 'expired', 'revoked']);
const RISKS = Object.freeze(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE']);

function isValidIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalize(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function looksLikeSecret(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return /^(Bearer\s+\S+|sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.test(text);
}

function validateVerificationRef(value) {
  if (value == null) return { valid: true, value: null };
  const ref = normalize(value);
  if (!ref) return { valid: false, value: null, reason: 'verification_ref_invalid' };
  if (looksLikeSecret(ref)) return { valid: false, value: null, reason: 'verification_secret_rejected' };
  if (!/^verify:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(ref)) {
    return { valid: false, value: null, reason: 'verification_ref_invalid' };
  }
  return { valid: true, value: ref, reason: null };
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') return { valid: false, reason: 'record_invalid' };
  const required = ['authorization_id', 'request_id', 'execution_id', 'tool_id', 'operation', 'policy_version', 'created_at'];
  for (const field of required) {
    if (!normalize(record[field])) return { valid: false, reason: `${field}_missing` };
  }
  if (!RISKS.includes(record.risk_class)) return { valid: false, reason: 'risk_class_invalid' };
  if (!STATES.includes(record.status)) return { valid: false, reason: 'status_invalid' };
  if (!record.target || typeof record.target !== 'object' || Array.isArray(record.target)) return { valid: false, reason: 'target_invalid' };
  if (looksLikeSecret(JSON.stringify(record.target))) return { valid: false, reason: 'target_secret_rejected' };
  if (!isValidIso(record.created_at)) return { valid: false, reason: 'created_at_invalid' };
  if (record.approved_at !== null && !isValidIso(record.approved_at)) return { valid: false, reason: 'approved_at_invalid' };
  if (record.expires_at !== null && !isValidIso(record.expires_at)) return { valid: false, reason: 'expires_at_invalid' };
  const verification = validateVerificationRef(record.verification_ref);
  if (!verification.valid) return { valid: false, reason: verification.reason };
  return { valid: true, reason: null };
}

function bindingMatches(record, binding) {
  if (!record || !binding) return false;
  for (const field of ['request_id', 'execution_id', 'tool_id', 'operation', 'risk_class', 'policy_version']) {
    if (record[field] !== binding[field]) return false;
  }
  if (binding.target === undefined) return false;
  return stableJson(record.target) === stableJson(binding.target);
}

function isExecutable(record, binding, now = new Date()) {
  const validation = validateRecord(record);
  if (!validation.valid) return false;
  if (record.status !== 'approved' || !bindingMatches(record, binding)) return false;
  if (!normalize(record.approved_by) || !isValidIso(record.approved_at)) return false;
  if (record.expires_at && new Date(record.expires_at) <= now) return false;
  if (record.risk_class === 'HIGH_RISK_WRITE' || record.risk_class === 'DESTRUCTIVE') {
    if (!normalize(record.verification_ref)) return false;
  }
  return true;
}

function createApprovalStore(adapter) {
  if (!adapter || typeof adapter.create !== 'function' || typeof adapter.get !== 'function' || typeof adapter.transition !== 'function') {
    throw new TypeError('durable approval adapter must implement create, get, transition');
  }

  return {
    async create(record) {
      const check = validateRecord(record);
      if (!check.valid) throw new Error(check.reason);
      if (record.status !== 'pending') throw new Error('new_approval_must_be_pending');
      return adapter.create({ ...record });
    },

    async get(authorizationId) {
      return adapter.get(normalize(authorizationId));
    },

    async decide(authorizationId, decision) {
      const id = normalize(authorizationId);
      if (!id || !decision || typeof decision !== 'object') throw new Error('decision_invalid');
      const next = decision.status;
      if (!['approved', 'rejected', 'revoked'].includes(next)) throw new Error('decision_status_invalid');
      const record = await adapter.get(id);
      if (!record) throw new Error('authorization_not_found');
      const storedCheck = validateRecord(record);
      if (!storedCheck.valid) throw new Error(storedCheck.reason);
      if (record.status !== 'pending' && next !== 'revoked') throw new Error('invalid_transition');
      if (next === 'approved' && !normalize(decision.approved_by)) throw new Error('approved_by_required');
      if (next === 'approved' && !isValidIso(decision.approved_at)) throw new Error('approved_at_required');
      if (next === 'approved' && (record.risk_class === 'HIGH_RISK_WRITE' || record.risk_class === 'DESTRUCTIVE')) {
        const verification = validateVerificationRef(decision.verification_ref);
        if (!verification.valid || !verification.value) throw new Error(verification.reason ?? 'verification_required');
      }
      if ((next === 'approved' || next === 'rejected') && record.expires_at && new Date(record.expires_at) <= new Date()) throw new Error('authorization_expired');
      return adapter.transition(id, record.status, next, { ...decision });
    },

    async canExecute(authorizationId, binding, now) {
      const record = await adapter.get(normalize(authorizationId));
      return isExecutable(record, binding, now);
    }
  };
}

module.exports = {
  STATES,
  RISKS,
  validateRecord,
  validateVerificationRef,
  bindingMatches,
  isExecutable,
  createApprovalStore
};
