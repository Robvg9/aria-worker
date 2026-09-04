'use strict';

const assert = require('assert');
const { createSupabaseMissionRepository } = require('../execution/supabase-mission-repository');

function makeFetch(responseBody = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(responseBody); }
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

(async () => {
  assert.throws(() => createSupabaseMissionRepository(), /supabaseUrl required/);
  assert.throws(() => createSupabaseMissionRepository({ supabaseUrl: 'https://x' }), /serviceRoleKey required/);

  const fetchImpl = makeFetch({ mission_id: 'm1', goal: 'test', status: 'queued' });
  const repo = createSupabaseMissionRepository({
    supabaseUrl: 'https://example.supabase.co/',
    serviceRoleKey: 'secret-not-real',
    fetchImpl
  });

  await repo.createMission({ mission_id: 'm1', goal: 'test', status: 'queued' });
  await repo.getMission('m1');
  await repo.updateMission('m1', { mission_id: 'm1', goal: 'test', status: 'running' });
  await repo.appendEvent('m1', { event_type: 'checkpoint_saved', payload: {} });

  assert.strictEqual(fetchImpl.calls.length, 4);
  assert.ok(fetchImpl.calls.every((x) => x.options.method === 'POST'));
  assert.ok(fetchImpl.calls.every((x) => x.options.headers.authorization === 'Bearer secret-not-real'));
  assert.strictEqual(fetchImpl.calls[0].url, 'https://example.supabase.co/rest/v1/rpc/aria_mission_create');
  assert.strictEqual(fetchImpl.calls[1].url, 'https://example.supabase.co/rest/v1/rpc/aria_mission_get');
  assert.strictEqual(fetchImpl.calls[2].url, 'https://example.supabase.co/rest/v1/rpc/aria_mission_update');
  assert.strictEqual(fetchImpl.calls[3].url, 'https://example.supabase.co/rest/v1/rpc/aria_mission_append_event');

  console.log('Supabase mission repository tests passed');
})();
