'use strict';

const crypto = require('node:crypto');

const LEVELS = Object.freeze([
  'L0_READ_ONLY',
  'L1_GOVERNED_PROPOSAL',
  'L2_HUMAN_APPROVED_EXECUTION',
  'L3_PROGRESSIVE_AUTONOMY',
]);

function requireSchema(obj, schema, name) {
  if (!obj || obj.schema !== schema) throw new Error(`Missing or invalid ${name}`);
}

function certifyIntegration(bundle = {}) {
  requireSchema(bundle.inventory, 'aria.ecc-live-inventory.v1', 'inventory');
  requireSchema(bundle.registry, 'aria.ecc-capability-registry.v1', 'registry');
  requireSchema(bundle.drift, 'aria.ecc-drift-report.v1', 'drift report');
  requireSchema(bundle.compiled, 'aria.ecc-compiled-capabilities.v1', 'compiled capabilities');
  requireSchema(bundle.skills, 'aria.ecc-skills-layer.v1', 'skills layer');
  requireSchema(bundle.agents, 'aria.ecc-agent-adapter-layer.v1', 'agent adapter');
  requireSchema(bundle.context, 'aria.ecc-context.v1', 'context');
  requireSchema(bundle.selection, 'aria.ecc-specialist-selection.v1', 'selection');
  requireSchema(bundle.graph, 'aria.ecc-mission-graph.v1', 'mission graph');
  requireSchema(bundle.loop, 'aria.ecc-autonomous-loop.v1', 'autonomous loop');
  requireSchema(bundle.verification, 'aria.ecc-verification-loop.v1', 'verification');
  requireSchema(bundle.regression, 'aria.ecc-independent-review.v1', 'regression review');
  requireSchema(bundle.shield, 'aria.ecc-agentshield.v1', 'AgentShield');
  requireSchema(bundle.canvas, 'aria.ecc-plan-canvas.v1', 'Plan Canvas');
  requireSchema(bundle.audit, 'aria.ecc-harness-audit.v1', 'harness audit');

  const checks = [
    ['source_commit_consistent', bundle.registry.source.commit_sha === bundle.inventory.source.commit_sha &&
      bundle.compiled.source.commit_sha === bundle.inventory.source.commit_sha],
    ['drift_clean', bundle.drift.state === 'CLEAN'],
    ['verification_passed', bundle.verification.state === 'VERIFIED'],
    ['regression_promotion_reviewed', bundle.regression.summary?.promotion_allowed === true],
    ['agentshield_clean', bundle.shield.summary?.blocked === 0 && bundle.shield.summary?.promotion_allowed === true],
    ['canvas_execution_disabled', bundle.canvas.execution?.state === 'DISABLED'],
    ['harness_audit_clean', bundle.audit.state === 'CLEAN'],
    ['mcp_default_disabled', bundle.mcp ? bundle.mcp.policy?.default_enabled === false : true],
    ['hooks_default_disabled', bundle.hooks ? bundle.hooks.policy?.default_enabled === false : true],
    ['ecc2_declared_alpha', bundle.ecc2?.status === 'ALPHA'],
  ].map(([code, passed]) => ({ code, passed }));

  const failed = checks.filter(c => !c.passed);

  let level = 'L0_READ_ONLY';
  if (failed.length === 0) level = 'L1_GOVERNED_PROPOSAL';
  if (failed.length === 0 && bundle.approval?.human_approved === true) level = 'L2_HUMAN_APPROVED_EXECUTION';
  if (level === 'L2_HUMAN_APPROVED_EXECUTION' && bundle.approval?.progressive_autonomy_approved === true) level = 'L3_PROGRESSIVE_AUTONOMY';

  const ecc2 = {
    status: 'ALPHA',
    source_path: 'ecc2/',
    source_commit_sha: bundle.inventory.source.commit_sha,
    runtime_activation: 'DISABLED',
    note: 'ECC2 is an alpha control-plane scaffold; not treated as GA or automatic deployment authority.',
  };

  const canonical = {
    schema: 'aria.ecc-final-certification.v1',
    deterministic: true,
    state: failed.length ? 'NOT_CERTIFIED' : 'CERTIFIED',
    ecc2,
    checks,
    progressive_autonomy: {
      levels: LEVELS,
      current_level: level,
      automatic_promotion: false,
      requires_explicit_approval: true,
    },
    upstream_sync: {
      locked_tag: bundle.inventory.source.tag,
      locked_commit_sha: bundle.inventory.source.commit_sha,
      update_policy: 'PROPOSE_AND_REVERIFY',
      automatic_lock_update: false,
    },
    catalog: {
      inventory_digest_sha256: bundle.inventory.digest_sha256,
      registry_digest_sha256: bundle.registry.registry_digest_sha256,
      compiled_digest_sha256: bundle.compiled.compile_digest_sha256,
      total_inventory_entries: bundle.inventory.summary?.total_entries ?? null,
      total_capabilities: bundle.registry.summary?.total_capabilities ?? null,
    },
  };

  return {
    ...canonical,
    certification_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
  };
}

module.exports = { LEVELS: [...LEVELS], certifyIntegration };
