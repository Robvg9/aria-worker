'use strict';
const assert = require('node:assert/strict');
const { createDurableSessionStore } = require('../execution-engine/durable-session');

(async () => {
  const saved = new Map();
  const events = [];
  const store = createDurableSessionStore({
    save: async s => saved.set(s.session_id, s),
    load: async id => saved.get(id) || null,
    appendEvent: async (id, event) => events.push({ id, event }),
  });
  await store.checkpoint({ session_id: 's1', state: 'running', step_index: 1 });
  assert.equal((await store.resume('s1')).step_index, 1);
  await store.transition('s1', 'waiting', { reason: 'external_event' });
  assert.equal((await store.resume('s1')).state, 'waiting');
  await store.transition('s1', 'succeeded', { result_ref: 'artifact://1' });
  assert.equal((await store.resume('s1')).state, 'succeeded');
  await assert.rejects(() => store.transition('s1', 'running'), /terminal_session_immutable/);
  assert.equal((await store.resume('missing')).status, 'not_found');
  assert.ok(events.length >= 2);
  console.log('DURABLE SESSION TESTS PASS');
})();
