'use strict';

const { buildSandboxPlan } = require('./sandbox-controller');
const { evaluateSandbox } = require('./regression-gate');
const { decidePromotion, promoteCandidate } = require('./promotion-gate');

function createBattleCruiserBridge({ workspace, executor } = {}) {
  if (!workspace || typeof workspace.createBranch !== 'function' || typeof workspace.read !== 'function' || typeof workspace.apply !== 'function' || typeof workspace.openPullRequest !== 'function') {
    throw new TypeError('governed github workspace required');
  }
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('universal executor required');

  async function run({ repository = 'Robvg9/battlecruiser', branch, files = [], changes = [], evaluationCases = [], baseline = null, policy = {} } = {}) {
    const plan = buildSandboxPlan({ repository, sandboxBranch: branch, files });
    const audit = [];
    audit.push({ phase: 'inspect', status: 'planned', operation: plan[0].operation });
    audit.push({ phase: 'plan', status: 'planned', operation: plan[1].operation });

    await workspace.createBranch(branch);
    audit.push({ phase: 'branch_sandbox', status: 'succeeded', branch });

    for (const change of changes) {
      const step = { executor_type: 'connector', operation: 'file_write', target: { type: 'connector', connector_id: 'github' }, input: change, policy };
      const result = await executor.execute({ missionId: `bc4-${branch}`, step, policy });
      if (result?.status !== 'succeeded') return Object.freeze({ status: 'failed', phase: 'modify', branch, result, audit });
      audit.push({ phase: 'modify', status: 'succeeded', path: change.path });
    }

    const evaluation = await evaluateSandbox({ branch, baseline, cases: evaluationCases, context: { branch, repository }, failFast: false });
    audit.push({ phase: 'regression', status: evaluation.status, decision: evaluation.decision });
    audit.push({ phase: 'evaluate', status: evaluation.status, decision: evaluation.decision });

    const promotion = decidePromotion({ evaluation, branch });
    return Object.freeze({ status: evaluation.status, branch, evaluation, promotion, audit });
  }

  async function promote({ evaluation, branch, title, body } = {}) {
    return promoteCandidate({ workspace, evaluation, branch, title, body });
  }

  return Object.freeze({ run, promote });
}

module.exports = Object.freeze({ createBattleCruiserBridge });
