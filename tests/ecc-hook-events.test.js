'use strict';

const assert = require('node:assert/strict');
const {
  buildHookEventCatalog,
  buildHookActivationProposal,
} = require('../scripts/ecc-hook-events');

const metadata = {
  entries: {
    SessionStart: [
      { id: 'session:start', description: 'Load previous context', fingerprint: 'abc' },
    ],
    PreToolUse: [
      { id: 'pre:tool', description: 'Pre tool check', fingerprint: 'def' },
    ],
    PostToolUseFailure: [
      { id: 'post:failure', description: 'Track tool failures', fingerprint: 'ghi' },
    ],
    Stop: [
      { id: 'stop:end', description: 'Persist state', fingerprint: 'jkl' },
    ],
  },
};

const catalog = buildHookEventCatalog(metadata, {
  tag: 'v2.2.3',
  commit_sha: 'commit',
  path: 'hooks/hooks.metadata.json',
  sha: 'sha',
});

assert.equal(catalog.schema, 'aria.ecc-hook-event-catalog.v1');
assert.equal(catalog.summary.total_hooks, 4);
assert.equal(catalog.summary.event_types, 4);
assert.equal(catalog.summary.enabled, 0);
assert.equal(catalog.summary.execution_grants, 0);
assert.ok(catalog.hooks.every(h => h.activation_state === 'DISABLED'));
assert.ok(catalog.hooks.every(h => h.command_reference === null));
assert.ok(catalog.hooks.every(h => h.handler_reference === null));
assert.equal(catalog.catalog_digest_sha256.length, 64);

const proposal = buildHookActivationProposal(catalog, [catalog.hooks[0].hook_event_id]);
assert.equal(proposal.schema, 'aria.ecc-hook-activation-proposal.v1');
assert.equal(proposal.policy.approved_by_aria, false);
assert.equal(proposal.selections[0].enabled, false);
assert.equal(proposal.selections[0].activation_state, 'AWAITING_ARIA_APPROVAL');
assert.equal(proposal.proposal_digest_sha256.length, 64);

assert.throws(
  () => buildHookEventCatalog({
    entries: { UnknownEvent: [{ id: 'x' }] },
  }, { tag: 'v2.2.3', commit_sha: 'commit', path: 'x', sha: 'sha' }),
  /Unsupported hook event type/,
);

assert.throws(
  () => buildHookEventCatalog({
    entries: { PreToolUse: [{ id: 'x' }] },
  }, { tag: 'v2.2.3', commit_sha: 'commit', path: 'x', sha: 'sha' }),
  /Unsupported hook event type/,
);

assert.throws(
  () => buildHookActivationProposal(catalog, ['missing']),
  /Unknown hook event/,
);

console.log('ECC HOOK EVENT TEST: PASS');
