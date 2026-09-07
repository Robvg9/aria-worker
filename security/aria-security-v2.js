'use strict';

const crypto = require('crypto');
const { RISK_ORDER } = require('./agent-policy');

const SCOPES = Object.freeze(['missions','agents','executors','self_development','self_modification']);
const HASH_RE = /^[a-f0-9]{64}$/;

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function sign(value, secret) {
  if (!secret || typeof secret !== 'string' || secret.length < 16) throw new Error('signing_key_required');
  return crypto.createHmac('sha256', secret).update(stable(value)).digest('hex');
}
function verifySignature(value, signature, secret) {
  if (!signature || !secret) return false;
  const expected = sign(value, secret);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
}
function assertScope(scope) { if (!SCOPES.includes(scope)) throw new Error(`invalid_kill_scope:${scope}`); }

function createSecurityControlPlane({ auditStore = null, secret = null, now = () => new Date().toISOString() } = {}) {
  const identities = new Map();
  const grants = new Map();
  const revoked = new Set();
  const kill = new Map(SCOPES.map(s => [s, { active: false, reason: null, at: null }]));
  let state = { version: 2, identities: [], grants: [], revoked: [], kill: Object.fromEntries(kill) };
  let stateHash = digest(state);

  function writeAudit(event) {
    const record = { at: now(), ...event, state_hash: stateHash };
    if (secret) record.signature = sign(record, secret);
    if (auditStore && typeof auditStore.append === 'function') auditStore.append(record);
    return Object.freeze(record);
  }
  function refreshState() {
    state = {
      version: 2,
      identities: [...identities.values()].map(({secret: _secret, ...x}) => x).sort((a,b) => a.id.localeCompare(b.id)),
      grants: [...grants.values()].map(x => ({...x, capabilities:[...x.capabilities].sort()})).sort((a,b) => a.id.localeCompare(b.id)),
      revoked: [...revoked].sort(),
      kill: Object.fromEntries([...kill.entries()].sort())
    };
    stateHash = digest(state);
  }

  function registerIdentity({ id, kind = 'agent', owner = 'aria', capabilities = [], maxRisk = 'low' } = {}) {
    if (!id) throw new Error('identity_id_required');
    if (identities.has(id)) throw new Error('identity_exists');
    if (RISK_ORDER[String(maxRisk).toLowerCase()] === undefined) throw new Error('invalid_max_risk');
    const identity = Object.freeze({ id, kind, owner, capabilities: [...new Set(capabilities)], maxRisk: String(maxRisk).toLowerCase(), created_at: now() });
    identities.set(id, identity); revoked.delete(id); refreshState(); writeAudit({ action:'identity.register', identity_id:id }); return identity;
  }
  function revokeCapability(identityId, capability) {
    const grant = grants.get(identityId) || { id: identityId, capabilities: [], maxRisk: identities.get(identityId)?.maxRisk || 'low' };
    grant.capabilities = grant.capabilities.filter(x => x !== capability); grants.set(identityId, grant); refreshState(); return writeAudit({ action:'capability.revoke', identity_id:identityId, capability });
  }
  function grantCapabilities(identityId, capabilities, maxRisk) {
    const identity = identities.get(identityId); if (!identity) throw new Error('identity_not_found');
    if (revoked.has(identityId)) throw new Error('identity_revoked');
    const g = { id: identityId, capabilities: [...new Set(capabilities)], maxRisk: String(maxRisk || identity.maxRisk).toLowerCase() };
    if (RISK_ORDER[g.maxRisk] === undefined) throw new Error('invalid_max_risk');
    grants.set(identityId, g); refreshState(); writeAudit({ action:'capability.grant', identity_id:identityId, capabilities:g.capabilities }); return Object.freeze(g);
  }
  function authorize({ identityId, capability, risk = 'read', scope = 'executors', operation, requireHumanGate = false } = {}) {
    const id = identities.get(identityId); const g = grants.get(identityId);
    if (!id || !g) return { allowed:false, reason:'identity_or_grant_missing' };
    if (revoked.has(identityId)) return { allowed:false, reason:'identity_revoked' };
    if (kill.get(scope)?.active) return { allowed:false, reason:'kill_switch_active', scope };
    if (!g.capabilities.includes(capability)) return { allowed:false, reason:'capability_denied' };
    const requested = String(risk || 'read').toLowerCase();
    if (RISK_ORDER[requested] === undefined || RISK_ORDER[requested] > RISK_ORDER[g.maxRisk]) return { allowed:false, reason:'risk_exceeded' };
    if (!operation) return { allowed:false, reason:'operation_required' };
    if (requireHumanGate) return { allowed:false, reason:'human_gate_required' };
    return { allowed:true, reason:'authorized', identity_id:identityId, capability, scope };
  }
  function issueActionEnvelope({ identityId, capability, risk='read', scope='executors', operation, ttlMs=120000 } = {}) {
    const decision = authorize({ identityId, capability, risk, scope, operation });
    if (!decision.allowed) throw new Error(`authorization_denied:${decision.reason}`);
    const payload = Object.freeze({ version:2, identity_id:identityId, capability, risk:String(risk).toLowerCase(), scope, operation, expires_at:new Date(Date.now()+ttlMs).toISOString(), nonce:crypto.randomUUID() });
    return Object.freeze({ payload, signature: secret ? sign(payload, secret) : null });
  }
  function verifyActionEnvelope(envelope) {
    if (!envelope?.payload) return { valid:false, reason:'envelope_missing' };
    if (kill.get(envelope.payload.scope)?.active) return { valid:false, reason:'kill_switch_active' };
    if (new Date(envelope.payload.expires_at).getTime() <= Date.now()) return { valid:false, reason:'envelope_expired' };
    if (revoked.has(envelope.payload.identity_id)) return { valid:false, reason:'identity_revoked' };
    if (secret && !verifySignature(envelope.payload, envelope.signature, secret)) return { valid:false, reason:'invalid_signature' };
    return { valid:true, reason:'envelope_valid' };
  }
  function killSwitch(scope, reason='emergency_stop') {
    assertScope(scope); kill.set(scope, { active:true, reason, at:now() }); refreshState(); return writeAudit({ action:'kill.activate', scope, reason });
  }
  function releaseKillSwitch(scope, reason='authorized_resume') {
    assertScope(scope); kill.set(scope, { active:false, reason, at:now() }); refreshState(); return writeAudit({ action:'kill.release', scope, reason });
  }
  function emergencyStop(reason='emergency_stop') { SCOPES.forEach(scope => kill.set(scope, { active:true, reason, at:now() })); refreshState(); return writeAudit({ action:'kill.global_activate', reason }); }
  function isStopped(scope) { assertScope(scope); return kill.get(scope).active; }
  function revokeIdentity(identityId, reason='revoked') { if (!identities.has(identityId)) throw new Error('identity_not_found'); revoked.add(identityId); refreshState(); return writeAudit({ action:'identity.revoke', identity_id:identityId, reason }); }
  function integrity() { const recomputed = digest(state); return Object.freeze({ valid: HASH_RE.test(stateHash) && recomputed === stateHash, state_hash: stateHash }); }
  function snapshot() { return Object.freeze(JSON.parse(JSON.stringify(state))); }
  function recover(expectedHash) { if (!HASH_RE.test(expectedHash)) throw new Error('expected_hash_required'); if (expectedHash !== digest(state)) throw new Error('state_integrity_mismatch'); stateHash = expectedHash; return { recovered:true, state_hash:stateHash }; }

  return Object.freeze({ registerIdentity, grantCapabilities, revokeCapability, authorize, issueActionEnvelope, verifyActionEnvelope, killSwitch, releaseKillSwitch, emergencyStop, isStopped, revokeIdentity, integrity, snapshot, recover });
}

module.exports = Object.freeze({ SCOPES, stable, digest, sign, verifySignature, createSecurityControlPlane });
