'use strict';

const assert = require('node:assert/strict');
const { createSupabaseApprovalAdapter } = require('../approvals/supabase-adapter');

function makeQuery(result) {
  const query = {
    insert(record) { query.record = record; return query; },
    update(patch) { query.patch = patch; return query; },
    select() { return query; },
    single: async () => ({ data: query.data ?? { ...query.record, ...query.patch }, error: null }),
    maybeSingle: async () => ({ data: query.data ?? null, error: null }),
    eq() { return query; }
  };
  if (result) query.data = result;
  return query;
}

async function run() {
  const calls = [];
  const client = {
    schema(name) {
      calls.push(['schema', name]);
      return {
        from(table) {
          calls.push(['from', table]);
          return makeQuery({ authorization_id: 'auth_1', status: 'approved' });
        }
      };
    }
  };
  const adapter = createSupabaseApprovalAdapter(client);
  const record = { authorization_id: 'auth_1', status: 'pending' };
  const created = await adapter.create(record);
  assert.equal(created.authorization_id, 'auth_1');
  const fetched = await adapter.get('auth_1');
  assert.equal(fetched.status, 'approved');
  const transitioned = await adapter.transition('auth_1', 'pending', 'approved', {
    approved_by: 'Robert',
    approved_at: '2026-09-02T12:00:00.000Z',
    verification_ref: 'verify_1',
    updated_at: '2026-09-02T12:00:01.000Z'
  });
  assert.equal(transitioned.status, 'approved');
  assert.equal(calls.filter((x) => x[0] === 'schema').length >= 3, true);

  assert.throws(() => createSupabaseApprovalAdapter(null), /supabase client must be injected/);
  assert.equal(await adapter.get(''), null);
  console.log('PASS: Supabase durable approval adapter tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
