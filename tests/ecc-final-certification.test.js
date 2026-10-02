'use strict';

const assert = require('node:assert/strict');
const { certifyIntegration, LEVELS } = require('../scripts/ecc-final-certification');

const base = (schema) => ({ schema });

const bundle = {
  inventory: { ...base('aria.ecc-live-inventory.v1'), source: { tag: 'v2.2.3', commit_sha: 'c' }, digest_sha256: 'i', summary: { total_entries: 100 } },
  registry: { ...base('aria.ecc-capability-registry.v1'), source: { commit_sha: 'c' }, registry_digest_sha256: 'r', summary: { total_capabilities: 3 } },
  drift: { ...base('aria.ecc-drift-report.v1'), state: 'CLEAN' },
  compiled: { ...base('aria.ecc-compiled-capabilities.v1'), source: { commit_sha: 'c' }, compile_digest_sha256: 'k' },
  skills: base('aria.ecc-skills-layer.v1'),
  agents: base('aria.ecc-agent-adapter-layer.v1'),
  context: base('aria.ecc-context.v1'),
  selection: base('aria.ecc-specialist-selection.v1'),
  graph: base('aria.ecc-mission-graph.v1'),
  loop: base('aria.ecc-autonomous-loop.v1'),
  verification: { ...base('aria.ecc-verification-loop.v1'), state: 'VERIFIED' },
  regression: { ...base('aria.ecc-independent-review.v1'), summary: { promotion_allowed: true } },
  shield: { ...base('aria.ecc-agentshield.v1'), summary: { blocked: 0, promotion_allowed: true } },
  canvas: { ...base('aria.ecc-plan-canvas.v1'), execution: { state: 'DISABLED' } },
  audit: { ...base('aria.ecc-harness-audit.v1'), state: 'CLEAN' },
  mcp: { policy: { default_enabled: false } },
  hooks: { policy: { default_enabled: false } },
  ecc2: { status: 'ALPHA' },
};

const cert = certifyIntegration(bundle);
assert.equal(cert.schema, 'aria.ecc-final-certification.v1');
assert.equal(cert.state, 'CERTIFIED');
assert.equal(cert.progressive_autonomy.current_level, 'L1_GOVERNED_PROPOSAL');
assert.equal(cert.progressive_autonomy.automatic_promotion, false);
assert.equal(cert.ecc2.runtime_activation, 'DISABLED');
assert.equal(cert.catalog.total_inventory_entries, 100);
assert.equal(cert.certification_digest_sha256.length, 64);

const l2 = certifyIntegration({ ...bundle, approval: { human_approved: true } });
assert.equal(l2.progressive_autonomy.current_level, 'L2_HUMAN_APPROVED_EXECUTION');

const l3 = certifyIntegration({ ...bundle, approval: { human_approved: true, progressive_autonomy_approved: true } });
assert.equal(l3.progressive_autonomy.current_level, 'L3_PROGRESSIVE_AUTONOMY');

const broken = certifyIntegration({
  ...bundle,
  drift: { ...bundle.drift, state: 'DRIFT' },
});
assert.equal(broken.state, 'NOT_CERTIFIED');
assert.equal(broken.progressive_autonomy.current_level, 'L0_READ_ONLY');

assert.deepEqual(LEVELS, [
  'L0_READ_ONLY',
  'L1_GOVERNED_PROPOSAL',
  'L2_HUMAN_APPROVED_EXECUTION',
  'L3_PROGRESSIVE_AUTONOMY',
]);

console.log('ECC FINAL CERTIFICATION TEST: PASS');
