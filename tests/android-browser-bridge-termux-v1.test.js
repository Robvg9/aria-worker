'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseJob,
  secretRefFromPayload,
  requestLocalBridge,
  executeAndroidBrowserJob
} = require('../agents/termux/android-browser-bridge-v1');

function fakeFetch(expected) {
  return async (url, options = {}) => {
    expected.push({ url, options });
    if (url.endsWith('/v1/observe')) {
      return {
        status: 200,
        ok: true,
        async text() { return JSON.stringify({ ok: true, root: { id: '0', children: [] }, evidence_hash: 'h1' }); }
      };
    }
    return {
      status: 200,
      ok: true,
      async text() {
        return JSON.stringify({
          ok: true,
          evidence_hash: 'h2',
          ui: { root: { id: '0', children: [] }, packageName: 'com.android.chrome' }
        });
      }
    };
  };
}

test('parses observe and secret reference without resolving secret', () => {
  const observed = parseJob(JSON.stringify({ operation: 'observe' }));
  assert.equal(observed.operation, 'observe');
  assert.equal(secretRefFromPayload(observed), null);

  const action = parseJob(JSON.stringify({
    operation: 'action',
    action: { action: 'type', nodeId: '0.2', text: null },
    secret_ref: 'secret://rwht/rwht_android_password'
  }));
  assert.equal(secretRefFromPayload(action), 'secret://rwht/rwht_android_password');
  assert.equal(action.action.action, 'type');
});

test('rejects non-RWHT secret references', () => {
  assert.throws(
    () => secretRefFromPayload({ secret_ref: 'secret://supabase/service_role' }),
    /secret_ref_invalid/
  );
});

test('observes through the real local-bridge HTTP shape', async () => {
  const calls = [];
  const result = await requestLocalBridge({
    operation: 'observe',
    fetchImpl: fakeFetch(calls)
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:43817/v1/observe');
});

test('resolves secret only at execution time and never from persisted command', async () => {
  const calls = [];
  const command = JSON.stringify({
    operation: 'action',
    action: { action: 'type', nodeId: '0.2', text: null },
    secret_ref: 'secret://rwht/rwht_android_password'
  });

  let resolved = 0;
  const result = await executeAndroidBrowserJob({
    command,
    resolveSecret: async ref => {
      assert.equal(ref, 'secret://rwht/rwht_android_password');
      resolved += 1;
      return 'runtime-only-secret';
    },
    fetchImpl: fakeFetch(calls)
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(resolved, 1);
  assert.match(calls[0].options.body, /runtime-only-secret/);
  assert.doesNotMatch(command, /runtime-only-secret/);
});
