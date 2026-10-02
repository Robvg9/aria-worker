'use strict';

const crypto = require('node:crypto');

const TERMINAL_STATES = new Set(['COMPLETED', 'SUCCEEDED', 'FAILED', 'STOPPED', 'CANCELLED', 'BLOCKED']);

function check(code, passed, details = null) {
  return { code, passed: Boolean(passed), ...(details ? { details } : {}) };
}

function verifyMission(graph, loop, result = {}, evidenceRefs = []) {
  if (!graph || graph.schema !== 'aria.ecc-mission-graph.v1') {
    throw new Error('Unsupported mission graph schema');
  }
  if (!loop || loop.schema !== 'aria.ecc-autonomous-loop.v1') {
    throw new Error('Unsupported autonomous loop schema');
  }
  if (loop.graph_digest_sha256 !== graph.graph_digest_sha256) {
    return {
      schema: 'aria.ecc-verification-loop.v1',
      state: 'FAILED',
      passed: false,
      checks: [check('graph_digest_match', false)],
      evidence_refs: [...evidenceRefs].sort(),
    };
  }

  const checks = [
    check('graph_planned', graph.state === 'PLANNED'),
    check('graph_execution_disabled', graph.execution_state === 'DISABLED'),
    check('graph_has_verification_node', (graph.nodes || []).some(n => n.type === 'VERIFY')),
    check('graph_has_evidence_node', (graph.nodes || []).some(n => n.type === 'EVIDENCE')),
    check('loop_terminal', TERMINAL_STATES.has(String(loop.state).toUpperCase())),
    check('permission_grants_zero', Number(loop.permission_grants || 0) === 0),
    check('result_present', result !== null && typeof result === 'object'),
    check('evidence_present', Array.isArray(evidenceRefs) && evidenceRefs.length > 0),
    check('security_no_secrets', !/(api[_-]?key|bearer\s+[A-Za-z0-9._-]{12,}|password|secret)/i.test(JSON.stringify(result))),
  ];

  const passed = checks.every(c => c.passed);
  const canonical = {
    schema: 'aria.ecc-verification-loop.v1',
    deterministic: true,
    state: passed ? 'VERIFIED' : 'FAILED',
    passed,
    graph_digest_sha256: graph.graph_digest_sha256,
    loop_id: loop.loop_id,
    loop_state: loop.state,
    checks,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
    policy: {
      require_terminal_loop: true,
      require_evidence: true,
      require_zero_permission_grants: true,
      auto_promote: false,
    },
  };

  return {
    ...canonical,
    verification_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
  };
}

module.exports = { verifyMission, check };
