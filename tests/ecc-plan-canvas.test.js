'use strict';

const assert = require('node:assert/strict');
const { buildPlanCanvas, reviewPlanCanvas } = require('../scripts/ecc-plan-canvas');

const graph = {
  schema: 'aria.ecc-mission-graph.v1',
  graph_digest_sha256: 'graph',
  selected_specialist: { capability_id: 'a1', name: 'reviewer' },
  nodes: [{ id: 'context' }, { id: 'verify' }],
  edges: [{ from: 'context', to: 'verify' }],
};

const verification = {
  schema: 'aria.ecc-verification-loop.v1',
  state: 'VERIFIED',
  verification_digest_sha256: 'verify',
};

const shield = {
  schema: 'aria.ecc-agentshield.v1',
  shield_digest_sha256: 'shield',
};

const canvas = buildPlanCanvas({
  graph,
  verification,
  shield,
  objective: 'Review ECC plan',
});

assert.equal(canvas.schema, 'aria.ecc-plan-canvas.v1');
assert.equal(canvas.review_state, 'PENDING_REVIEW');
assert.equal(canvas.actions.approve_enabled, true);
assert.equal(canvas.actions.execute_enabled, false);
assert.equal(canvas.execution.state, 'DISABLED');
assert.equal(canvas.execution.promotion_allowed, false);
assert.equal(canvas.summary.node_count, 2);
assert.equal(canvas.canvas_digest_sha256.length, 64);

const approved = reviewPlanCanvas(canvas, {
  reviewer_id: 'human-1',
  decision: 'approve',
  reviewed_at: '2026-10-02T16:00:00Z',
});
assert.equal(approved.review_state, 'APPROVED');
assert.equal(approved.actions.approve_enabled, false);
assert.equal(approved.actions.execute_enabled, false);
assert.equal(approved.execution.promotion_allowed, false);

const changes = reviewPlanCanvas(canvas, {
  reviewer_id: 'human-1',
  decision: 'request_changes',
  comments: ['Need clearer acceptance criteria'],
  changes_requested: ['acceptance'],
});
assert.equal(changes.review_state, 'CHANGES_REQUESTED');
assert.equal(changes.actions.edit_enabled, true);

assert.throws(
  () => buildPlanCanvas({ graph, verification: { ...verification, state: 'FAILED' }, shield }),
  /verified plan/,
);

assert.throws(
  () => reviewPlanCanvas(canvas, { decision: 'approve' }),
  /Reviewer id is required/,
);

console.log('ECC PLAN CANVAS TEST: PASS');
