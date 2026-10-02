'use strict';

const crypto = require('node:crypto');

const REVIEW_STATES = new Set(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED']);

function buildPlanCanvas(input = {}) {
  if (!input.graph || input.graph.schema !== 'aria.ecc-mission-graph.v1') {
    throw new Error('Plan Canvas requires a mission graph');
  }
  if (!input.verification || input.verification.schema !== 'aria.ecc-verification-loop.v1') {
    throw new Error('Plan Canvas requires verification evidence');
  }
  if (input.verification.state !== 'VERIFIED') {
    throw new Error('Plan Canvas requires a verified plan');
  }
  if (!input.shield || input.shield.schema !== 'aria.ecc-agentshield.v1') {
    throw new Error('Plan Canvas requires AgentShield evidence');
  }

  const state = input.state || 'PENDING_REVIEW';
  if (!REVIEW_STATES.has(state)) throw new Error(`Unsupported review state: ${state}`);

  const canvas = {
    schema: 'aria.ecc-plan-canvas.v1',
    deterministic: true,
    review_state: state,
    graph_digest_sha256: input.graph.graph_digest_sha256,
    verification_digest_sha256: input.verification.verification_digest_sha256,
    shield_digest_sha256: input.shield.shield_digest_sha256,
    summary: {
      objective: input.objective || null,
      specialist: input.graph.selected_specialist || null,
      node_count: (input.graph.nodes || []).length,
      edge_count: (input.graph.edges || []).length,
    },
    review: {
      reviewer_id: null,
      reviewed_at: null,
      comments: [],
      changes_requested: [],
    },
    actions: {
      approve_enabled: state === 'PENDING_REVIEW',
      reject_enabled: state === 'PENDING_REVIEW',
      edit_enabled: state === 'PENDING_REVIEW' || state === 'CHANGES_REQUESTED',
      execute_enabled: false,
    },
    execution: {
      state: 'DISABLED',
      promotion_allowed: false,
    },
  };

  return {
    ...canvas,
    canvas_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canvas), 'utf8').digest('hex'),
  };
}

function reviewPlanCanvas(canvas, review = {}) {
  if (!canvas || canvas.schema !== 'aria.ecc-plan-canvas.v1') {
    throw new Error('Unsupported Plan Canvas');
  }
  if (!review.reviewer_id) throw new Error('Reviewer id is required');
  if (!['approve', 'request_changes', 'reject'].includes(review.decision)) {
    throw new Error('Unsupported review decision');
  }

  const nextState = review.decision === 'approve'
    ? 'APPROVED'
    : review.decision === 'request_changes'
      ? 'CHANGES_REQUESTED'
      : 'REJECTED';

  const next = {
    ...canvas,
    review_state: nextState,
    review: {
      ...canvas.review,
      reviewer_id: String(review.reviewer_id),
      reviewed_at: review.reviewed_at || null,
      comments: [...(canvas.review.comments || []), ...(review.comments || [])],
      changes_requested: [...(canvas.review.changes_requested || []), ...(review.changes_requested || [])],
    },
    actions: {
      ...canvas.actions,
      approve_enabled: false,
      reject_enabled: false,
      edit_enabled: nextState === 'CHANGES_REQUESTED',
      execute_enabled: false,
    },
    execution: {
      state: 'DISABLED',
      promotion_allowed: false,
    },
  };

  delete next.canvas_digest_sha256;
  return {
    ...next,
    canvas_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(next), 'utf8').digest('hex'),
  };
}

module.exports = { buildPlanCanvas, reviewPlanCanvas };
