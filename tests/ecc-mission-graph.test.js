'use strict';

const assert = require('node:assert/strict');
const { translateToMissionGraph } = require('../scripts/ecc-mission-graph');

const context = {
  schema: 'aria.ecc-context.v1',
  state: 'RESOLVED',
  context_digest_sha256: 'ctx',
};

const selection = {
  schema: 'aria.ecc-specialist-selection.v1',
  selection_digest_sha256: 'sel',
  candidates: [
    { capability_id: 'a1', name: 'reviewer', proposal_state: 'PROPOSED' },
    { capability_id: 'a2', name: 'other', proposal_state: 'PROPOSED' },
  ],
};

const graph = translateToMissionGraph(context, selection, 'a1');
assert.equal(graph.schema, 'aria.ecc-mission-graph.v1');
assert.equal(graph.state, 'PLANNED');
assert.equal(graph.execution_state, 'DISABLED');
assert.equal(graph.selected_specialist.capability_id, 'a1');
assert.equal(graph.nodes.length, 5);
assert.equal(graph.edges.length, 4);
assert.equal(graph.policy.auto_execute, false);
assert.equal(graph.policy.auto_activate, false);
assert.equal(graph.policy.permission_grants, 0);
assert.equal(graph.graph_digest_sha256.length, 64);

const reversed = translateToMissionGraph(context, {
  ...selection,
  candidates: [...selection.candidates].reverse(),
}, 'a1');
assert.equal(graph.graph_digest_sha256, reversed.graph_digest_sha256);

assert.throws(
  () => translateToMissionGraph({ ...context, state: 'CONFLICT' }, selection, 'a1'),
  /resolved context/,
);
assert.throws(
  () => translateToMissionGraph(context, selection, 'missing'),
  /not a proposed candidate/,
);

console.log('ECC MISSION GRAPH TEST: PASS');
