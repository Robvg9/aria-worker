'use strict';

const { createSelfInspector } = require('./inspector');
const { createSelfDiagnoser } = require('./diagnosis');
const { createImprovementPlanner } = require('./planner');
const { verifyChange } = require('./verifier');
const { createSelfRollback } = require('./rollback');

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

function createSelfDevelopmentEngine({ snapshot, rules = [], workspace, testRunner, writer, snapshotStore = null, policy = {} } = {}) {
  const inspector = createSelfInspector({ snapshot });
  const diagnoser = createSelfDiagnoser({ rules });
  const planner = createImprovementPlanner({ allowMutation: async (change) => {
    const risk = change.risk_level || 'medium';
    const max = policy.max_risk || 'low';
    return RISK_ORDER[risk] <= RISK_ORDER[max];
  }});
  const rollback = snapshotStore && workspace && typeof workspace.restore === 'function'
    ? createSelfRollback({ workspace, snapshotStore })
    : null;

  async function improve({ objective = 'self_improvement', proposed_changes = [], scope = null } = {}) {
    const inspection = await inspector.inspect({ include: scope || inspector.allowedScopes });
    if (inspection.status !== 'succeeded') return { status: 'blocked', stage: 'inspection', reason: inspection.reason };
    const diagnosis = await diagnoser.diagnose(inspection.snapshot);
    const plan = await planner.plan({ findings: diagnosis.findings, objective, proposed_changes });
    const actionable = plan.changes.filter(change => change.status === 'proposed');
    if (!actionable.length) return { status: 'planned', inspection, diagnosis, plan, applied: [] };
    if (!workspace || typeof workspace.apply !== 'function' || typeof workspace.read !== 'function') return { status: 'blocked', stage: 'change', reason: 'workspace_boundary_required', inspection, diagnosis, plan };
    const before = [];
    for (const change of actionable) before.push({ path: change.path, before: await workspace.read(change.path) });
    const applied = [];
    for (const change of actionable) {
      const result = await workspace.apply(change);
      if (!result || result.status !== 'succeeded') {
        let rollbackResult = null;
        if (rollback && before.length) {
          for (const item of before) if (snapshotStore && typeof snapshotStore.save === 'function') await snapshotStore.save(item);
          rollbackResult = await rollback.rollback(applied);
        }
        return { status: 'failed', stage: 'change', applied, failed_path: change.path, rollback: rollbackResult, inspection, diagnosis, plan };
      }
      applied.push(change.path);
      if (snapshotStore && typeof snapshotStore.save === 'function') await snapshotStore.save(before.find(x => x.path === change.path));
    }
    const tests = typeof testRunner === 'function' ? await testRunner({ scope: applied, reason: objective }) : { status: 'failed', summary: 'test_runner_required' };
    const verification = await verifyChange({ tests, inspection: async () => {
      const after = await inspector.inspect({ include: ['version','identity','capabilities','tools','connectors','tests','git'] });
      return after.status === 'succeeded';
    }});
    if (!verification.verified) {
      const rollbackResult = rollback ? await rollback.rollback(applied) : { status: 'blocked', reason: 'rollback_boundary_unavailable' };
      return { status: 'failed', stage: 'verification', applied, before, tests, verification, rollback: rollbackResult };
    }
    const documentation = typeof writer === 'function' ? await writer({ objective, findings: diagnosis.findings, changes: actionable, tests, verification }) : { status: 'skipped' };
    return { status: 'succeeded', objective, inspection, diagnosis, plan, applied, tests, verification, documentation };
  }

  return Object.freeze({ improve, inspector, diagnoser, planner });
}

module.exports = { createSelfDevelopmentEngine };
