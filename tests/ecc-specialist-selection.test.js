'use strict';

const assert = require('node:assert/strict');
const { selectSpecialists } = require('../scripts/ecc-specialist-selection');

const context = {
  schema: 'aria.ecc-context.v1',
  state: 'RESOLVED',
  context_digest_sha256: 'context',
  constraints: {
    preferred_surfaces: ['codex'],
    forbidden_surfaces: ['legacy'],
  },
};

const agentLayer = {
  schema: 'aria.ecc-agent-adapter-layer.v1',
  source: { repository: 'ecc', tag: 'v2.2.3', commit_sha: 'commit' },
  adapter_digest_sha256: 'adapter',
  agents: [
    {
      capability_id: 'a2',
      name: 'plain',
      target_surfaces: [],
      lifecycle: { activation_state: 'DISABLED' },
      invocation: { requires_context: true, requires_selection: true, requires_verification: true },
    },
    {
      capability_id: 'a1',
      name: 'codex-reviewer',
      target_surfaces: ['codex'],
      lifecycle: { activation_state: 'DISABLED' },
      invocation: { requires_context: true, requires_selection: true, requires_verification: true },
    },
    {
      capability_id: 'a3',
      name: 'legacy-agent',
      target_surfaces: ['legacy'],
      lifecycle: { activation_state: 'DISABLED' },
      invocation: { requires_context: true, requires_selection: true, requires_verification: true },
    },
  ],
};

const result = selectSpecialists(context, agentLayer);
assert.equal(result.schema, 'aria.ecc-specialist-selection.v1');
assert.equal(result.summary.proposed, 2);
assert.equal(result.candidates[0].capability_id, 'a1');
assert.equal(result.candidates[0].proposal_state, 'PROPOSED');
assert.equal(result.candidates[1].capability_id, 'a2');
assert.equal(result.summary.execution_grants, 0);
assert.equal(result.summary.activated, 0);
assert.equal(result.policy.no_execution, true);
assert.equal(result.selection_digest_sha256.length, 64);

const reversed = selectSpecialists(context, {
  ...agentLayer,
  agents: [...agentLayer.agents].reverse(),
});
assert.equal(result.selection_digest_sha256, reversed.selection_digest_sha256);

assert.throws(
  () => selectSpecialists({ ...context, state: 'CONFLICT' }, agentLayer),
  /resolved context/,
);

console.log('ECC SPECIALIST SELECTION TEST: PASS');
