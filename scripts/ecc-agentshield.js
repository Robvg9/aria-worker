'use strict';

const crypto = require('node:crypto');
const { evaluateAction } = require('../security/agent-policy');

function evaluateCapabilitySecurity(compiled, requests = []) {
  if (!compiled || compiled.schema !== 'aria.ecc-compiled-capabilities.v1') {
    throw new Error('Unsupported compiled capability schema');
  }

  const allowed = new Set((compiled.compiled_capabilities || []).map(c => c.capability_id));
  const checks = requests.map(request => {
    const decision = evaluateAction({
      capability: request.capability_id,
      allowedCapabilities: [...allowed],
      operation: request.operation,
      risk: request.risk || 'read',
      maxRisk: request.max_risk || 'low',
      input: request.input,
    });

    return {
      capability_id: request.capability_id,
      operation: request.operation || null,
      risk: request.risk || 'read',
      max_risk: request.max_risk || 'low',
      allowed: decision.allowed,
      reason: decision.reason,
      state: decision.allowed ? 'PASS' : 'BLOCK_PROMOTION',
    };
  });

  const canonical = {
    schema: 'aria.ecc-agentshield.v1',
    deterministic: true,
    compiled_digest_sha256: compiled.compile_digest_sha256,
    checks: checks.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    policy: {
      deny_by_default: true,
      require_explicit_capability: true,
      require_operation: true,
      secret_rejection: true,
      prompt_injection_rejection: true,
      no_auto_promotion_on_failure: true,
    },
  };

  return {
    ...canonical,
    shield_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.allowed).length,
      blocked: checks.filter(c => !c.allowed).length,
      promotion_allowed: checks.length > 0 && checks.every(c => c.allowed),
    },
  };
}

module.exports = { evaluateCapabilitySecurity };
