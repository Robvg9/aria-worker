'use strict';

const assert = require('node:assert/strict');

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
        text: async () => JSON.stringify({
          ok: true,
          root: { id: '0', children: [] },
          evidence_hash: 'h1'
        })
      };
    }

    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        evidence_hash: 'h2',
        ui: { root: { id: '0', children: [] }, packageName: 'com.android.chrome' }
      })
    };
  };
}

(async () => {
  const observed = parseJob(JSON.stringify({ operation: 'observe' }));
  assert.equal(observed.operation, 'observe');
  assert.equal(secretRefFromPayload(observed), null);

  const securePayload = parseJob(JSON.stringify({
    operation: 'action',
    action: { action: 'type', nodeId: '0.2', text: null },
    secret_ref: 'secret://rwht/rwht_android_password'
  }));
  assert.equal(secretRefFromPayload(securePayload), 'secret://rwht/rwht_android_password');
  assert.equal(securePayload.action.action, 'type');

  assert.throws(
    () => secretRefFromPayload({ secret_ref: 'secret://supabase/service_role' }),
    /secret_ref invalid/
  );

  const calls = [];
  const observeResult = await requestLocalBridge({
    operation: 'observe',
    fetchImpl: fakeFetch(calls)
  });
  assert.equal(observeResult.status, 'succeeded');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:43817/v1/observe');

  const actionCalls = [];
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
    fetchImpl: fakeFetch(actionCalls)
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(resolved, 1);
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].url, 'http://127.0.0.1:43817/v1/action');
  assert.match(actionCalls[0].options.body, /runtime-only-secret/);
  assert.doesNotMatch(command, /runtime-only-secret/);

  console.log('ANDROID TERMUX BROWSER BRIDGE CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
