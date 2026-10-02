'use strict';

const crypto = require('node:crypto');

function translateToMissionGraph(context, selection, selectedCapabilityId) {
  if (!context || context.schema !== 'aria.ecc-context.v1' || context.state !== 'RESOLVED') {
    throw new Error('Mission Graph translation requires resolved context');
  }
  if (!selection || selection.schema !== 'aria.ecc-specialist-selection.v1') {
    throw new Error('Unsupported specialist selection schema');
  }
  const candidate = (selection.candidates || []).find(c => c.capability_id === selectedCapabilityId);
  if (!candidate || candidate.proposal_state !== 'PROPOSED') {
    throw new Error('Selected specialist is not a proposed candidate');
  }

  const nodes = [
    { id: 'context', type: 'CONTEXT', state: 'READY' },
    { id: 'load-capability', type: 'LOAD_CAPABILITY', capability_id: selectedCapabilityId, state: 'PLANNED' },
    { id: 'invoke-specialist', type: 'INVOKE_SPECIALIST', capability_id: selectedCapabilityId, state: 'PLANNED' },
    { id: 'verify-result', type: 'VERIFY', state: 'PLANNED' },
    { id: 'persist-evidence', type: 'EVIDENCE', state: 'PLANNED' },
  ];

  const edges = [
    { from: 'context', to: 'load-capability' },
    { from: 'load-capability', to: 'invoke-specialist' },
    { from: 'invoke-specialist', to: 'verify-result' },
    { from: 'verify-result', to: 'persist-evidence' },
  ];

  const canonical = {
    schema: 'aria.ecc-mission-graph.v1',
    deterministic: true,
    state: 'PLANNED',
    execution_state: 'DISABLED',
    context_digest_sha256: context.context_digest_sha256,
    selection_digest_sha256: selection.selection_digest_sha256,
    selected_specialist: {
      capability_id: candidate.capability_id,
      name: candidate.name,
    },
    nodes,
    edges,
    policy: {
      auto_execute: false,
      auto_activate: false,
      permission_grants: 0,
      verification_required: true,
      evidence_required: true,
    },
  };

  return {
    ...canonical,
    graph_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
  };
}

module.exports = { translateToMissionGraph };
