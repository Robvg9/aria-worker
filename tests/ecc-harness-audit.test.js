'use strict';

const assert = require('node:assert/strict');
const { auditIntegration, emitControlEvent } = require('../scripts/ecc-harness-audit');

const good = (schema) => ({ schema });

const bundle = {
  inventory: { ...good('aria.ecc-live-inventory.v1'), source: { commit_sha: 'c' } },
  registry: { ...good('aria.ecc-capability-registry.v1'), source: { commit_sha: 'c' }, summary: { activation_count: 0, enabled_count: 0 } },
  drift: good('aria.ecc-drift-report.v1'),
  compiled: { ...good('aria.ecc-compiled-capabilities.v1'), source: { commit_sha: 'c' } },
  context: good('aria.ecc-context.v1'),
  skills: { ...good('aria.ecc-skills-layer.v1'), summary: { enabled: 0 } },
  agents: { ...good('aria.ecc-agent-adapter-layer.v1'), summary: { execution_grants: 0 } },
  selection: good('aria.ecc-specialist-selection.v1'),
  graph: { ...good('aria.ecc-mission-graph.v1'), execution_state: 'DISABLED' },
  loop: { ...good('aria.ecc-autonomous-loop.v1'), execution_authority: 'EXTERNAL_RUNTIME_ONLY' },
  verification: { ...good('aria.ecc-verification-loop.v1'), state: 'VERIFIED' },
  regression: good('aria.ecc-independent-review.v1'),
  shield: { ...good('aria.ecc-agentshield.v1'), policy: { no_auto_promotion_on_failure: true } },
  canvas: { ...good('aria.ecc-plan-canvas.v1'), actions: { execute_enabled: false }, execution: { state: 'DISABLED' } },
};

const audit = auditIntegration(bundle);
assert.equal(audit.schema, 'aria.ecc-harness-audit.v1');
assert.equal(audit.state, 'CLEAN');
assert.equal(audit.summary.failed, 0);
assert.equal(audit.audit_digest_sha256.length, 64);

const broken = auditIntegration({
  ...bundle,
  verification: { ...bundle.verification, state: 'FAILED' },
});
assert.equal(broken.state, 'ISSUES_FOUND');
assert.ok(broken.checks.some(c => c.code === 'verification_state' && !c.passed));

const event = emitControlEvent({
  type: 'PHASE_PROGRESS',
  phase: 22,
  status: 'PASS',
  timestamp: '2026-10-02T16:30:00Z',
  evidence_refs: ['ev2', 'ev1'],
});
assert.equal(event.schema, 'aria.ecc-control-event.v1');
assert.deepEqual(event.evidence_refs, ['ev1', 'ev2']);
assert.equal(event.event_id.length, 24);

assert.throws(
  () => emitControlEvent({ type: 'X' }),
  /timestamp is required/,
);

console.log('ECC HARNESS AUDIT TEST: PASS');
