'use strict';

const { requireBranch } = require('./regression-gate');

function decidePromotion({ evaluation, branch, title, body } = {}) {
  requireBranch(branch);
  if (!evaluation || typeof evaluation !== 'object') throw new Error('evaluation_required');
  if (evaluation.branch && evaluation.branch !== branch) throw new Error('evaluation_branch_mismatch');
  if (evaluation.decision !== 'keep_candidate' || evaluation.status !== 'passed') {
    return Object.freeze({ status: 'blocked', decision: 'reject_promotion', branch, reason: 'evaluation_not_approved' });
  }
  return Object.freeze({
    status: 'approved',
    decision: 'open_pull_request',
    branch,
    title: title || 'feat: ARIA governed BattleCruiser candidate',
    body: body || 'Generated after BattleCruiser sandbox regression/evaluation gate. Main remains untouched.'
  });
}

async function promoteCandidate({ workspace, evaluation, branch, title, body } = {}) {
  const plan = decidePromotion({ evaluation, branch, title, body });
  if (plan.status !== 'approved') return plan;
  if (!workspace || typeof workspace.openPullRequest !== 'function') throw new Error('github_workspace_required');
  const pr = await workspace.openPullRequest({ branch, title: plan.title, body: plan.body });
  return Object.freeze({ ...plan, pr });
}

module.exports = Object.freeze({ decidePromotion, promoteCandidate });
