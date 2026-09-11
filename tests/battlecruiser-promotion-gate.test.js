'use strict';

const assert = require('node:assert/strict');
const { decidePromotion, promoteCandidate } = require('../autonomy/battlecruiser/promotion-gate');

(async () => {
  const branch = 'aria/sandbox/bc6-proof';
  const approvedEvaluation = { status: 'passed', decision: 'keep_candidate', branch };
  const rejectedEvaluation = { status: 'failed', decision: 'reject_candidate', branch };

  const approved = decidePromotion({ evaluation: approvedEvaluation, branch });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.decision, 'open_pull_request');

  const blocked = decidePromotion({ evaluation: rejectedEvaluation, branch });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.decision, 'reject_promotion');

  const calls = [];
  const workspace = {
    async openPullRequest(input) {
      calls.push(input);
      return { number: 1234, html_url: 'https://github.com/Robvg9/battlecruiser/pull/1234' };
    }
  };
  const promoted = await promoteCandidate({ workspace, evaluation: approvedEvaluation, branch });
  assert.equal(promoted.status, 'approved');
  assert.equal(promoted.pr.number, 1234);
  assert.equal(calls.length, 1);

  await assert.rejects(
    () => promoteCandidate({ workspace, evaluation: approvedEvaluation, branch: 'main' }),
    /main_branch_forbidden|sandbox_branch_required/
  );

  console.log('BATTLECRUISER PROMOTION GATE: PASS — approved evaluation opens PR; failed evaluation and main branch are blocked');
})().catch(error => { console.error(error); process.exit(1); });
