'use strict';

const assert = require('node:assert/strict');
const {
  SOURCES,
  eventMode,
  buildHookEventAdapter,
} = require('../scripts/ecc-hook-event-adapter');

assert.equal(eventMode({ id: 'pre:config-protection', description: 'Block modifications' }), 'GUARD');
assert.equal(eventMode({ id: 'pre:observe', description: 'Capture tool observations' }), 'OBSERVE');
assert.equal(eventMode({ id: 'session:start', description: 'Load context' }), 'ADVISORY');

const metadata = {
  entries: {
    PreToolUse: [
      { id: 'pre:block', description: 'Block unsafe mutation', fingerprint: 'a' },
      { id: 'pre:observe', description: 'Capture usage', fingerprint: 'b' },
    ],
    Stop: [
      { id: 'stop:format', description: 'Format edited files', fingerprint: 'c' },
    ],
  },
};

const adapter = buildHookEventAdapter(metadata, SOURCES);
assert.equal(adapter.schema, 'aria.ecc-hook-event-adapter.v1');
assert.equal(adapter.summary.total_events, 3);
assert.equal(adapter.summary.guard_events, 1);
assert.equal(adapter.summary.observe_events, 1);
assert.equal(adapter.summary.advisory_events, 1);
assert.equal(adapter.summary.enabled, 0);
assert.ok(adapter.events.every(e => e.enabled === false));
assert.ok(adapter.events.every(e => e.approval_required === true));
assert.ok(adapter.events.every(e => e.execution_status === 'NOT_REGISTERED'));
assert.ok(adapter.events.every(e => e.handler === null));
assert.equal(adapter.policy.arbitrary_command_execution, false);
assert.equal(adapter.adapter_digest_sha256.length, 64);

const reversed = buildHookEventAdapter({
  entries: {
    Stop: [...metadata.entries.Stop],
    PreToolUse: [...metadata.entries.PreToolUse].reverse(),
  },
}, SOURCES);
assert.equal(adapter.adapter_digest_sha256, reversed.adapter_digest_sha256);

console.log('ECC HOOK EVENT ADAPTER TEST: PASS');
