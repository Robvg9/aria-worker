'use strict';

const crypto = require('node:crypto');

function check(code, passed, details = null) {
  return { code, passed: Boolean(passed), ...(details ? { details } : {}) };
}

function auditIntegration(bundle = {}) {
  const checks = [];

  const { inventory, registry, drift, compiled, context, skills, agents, selection, graph, loop, verification, regression, shield, canvas } = bundle;

  checks.push(check('inventory_present', inventory?.schema === 'aria.ecc-live-inventory.v1'));
  checks.push(check('registry_present', registry?.schema === 'aria.ecc-capability-registry.v1'));
  checks.push(check('drift_present', drift?.schema === 'aria.ecc-drift-report.v1'));
  checks.push(check('compiled_present', compiled?.schema === 'aria.ecc-compiled-capabilities.v1'));
  checks.push(check('context_present', context?.schema === 'aria.ecc-context.v1'));
  checks.push(check('skills_present', skills?.schema === 'aria.ecc-skills-layer.v1'));
  checks.push(check('agents_present', agents?.schema === 'aria.ecc-agent-adapter-layer.v1'));
  checks.push(check('selection_present', selection?.schema === 'aria.ecc-specialist-selection.v1'));
  checks.push(check('graph_present', graph?.schema === 'aria.ecc-mission-graph.v1'));
  checks.push(check('loop_present', loop?.schema === 'aria.ecc-autonomous-loop.v1'));
  checks.push(check('verification_present', verification?.schema === 'aria.ecc-verification-loop.v1'));
  checks.push(check('regression_present', regression?.schema === 'aria.ecc-independent-review.v1'));
  checks.push(check('shield_present', shield?.schema === 'aria.ecc-agentshield.v1'));
  checks.push(check('canvas_present', canvas?.schema === 'aria.ecc-plan-canvas.v1'));

  const sourceCommit = inventory?.source?.commit_sha;
  checks.push(check('registry_source_matches_inventory', registry?.source?.commit_sha === sourceCommit));
  checks.push(check('compiled_source_matches_registry', compiled?.source?.commit_sha === registry?.source?.commit_sha));
  checks.push(check('graph_execution_disabled', graph?.execution_state === 'DISABLED'));
  checks.push(check('loop_execution_authority_external', loop?.execution_authority === 'EXTERNAL_RUNTIME_ONLY'));
  checks.push(check('verification_state', verification?.state === 'VERIFIED'));
  checks.push(check('shield_no_promotion_on_failure', shield?.policy?.no_auto_promotion_on_failure === true));
  checks.push(check('canvas_execution_disabled', canvas?.actions?.execute_enabled === false && canvas?.execution?.state === 'DISABLED'));
  checks.push(check('no_registry_activation', Number(registry?.summary?.activation_count || 0) === 0));
  checks.push(check('no_registry_enablement', Number(registry?.summary?.enabled_count || 0) === 0));
  checks.push(check('no_skills_enablement', Number(skills?.summary?.enabled || 0) === 0));
  checks.push(check('no_agent_execution_grants', Number(agents?.summary?.execution_grants || 0) === 0));

  const failed = checks.filter(c => !c.passed);
  const canonical = {
    schema: 'aria.ecc-harness-audit.v1',
    deterministic: true,
    state: failed.length ? 'ISSUES_FOUND' : 'CLEAN',
    checks,
    policy: {
      fail_closed: true,
      no_auto_mutation: true,
      evidence_required: true,
    },
  };

  return {
    ...canonical,
    audit_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      total_checks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
  };
}

function emitControlEvent(event = {}) {
  if (!event.type) throw new Error('Control event type is required');
  if (!event.timestamp) throw new Error('Control event timestamp is required');

  return {
    schema: 'aria.ecc-control-event.v1',
    event_id: crypto.createHash('sha256')
      .update(JSON.stringify([event.type, event.timestamp, event.phase || null, event.status || null]), 'utf8')
      .digest('hex')
      .slice(0, 24),
    type: String(event.type),
    phase: event.phase ?? null,
    status: event.status ?? null,
    evidence_refs: [...new Set(event.evidence_refs || [])].sort(),
    metadata: event.metadata || {},
  };
}

module.exports = { auditIntegration, emitControlEvent, check };
