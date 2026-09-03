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
          return makeQuery({
            authorization_id: 'auth_1',
            status: 'approved',
            request_id: 'req_1',
            execution_id: 'exec_1',
            tool_id: 'github:repo_read',
            operation: 'repo_read',
            risk_class: 'READ',
            policy_version: 'aria-governance-v1.0.0',
            target: { repo: 'aria-worker', owner: 'Robvg9' },
            expires_at: '2099-01-01T00:00:00.000Z'
          });
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

  const executable = await adapter.canExecute('auth_1', {
    request_id: 'req_1',
    execution_id: 'exec_1',
    tool_id: 'github:repo_read',
    operation: 'repo_read',
    risk_class: 'READ',
    policy_version: 'aria-governance-v1.0.0',
    target: { owner: 'Robvg9', repo: 'aria-worker' }
  }, new Date('2026-09-03T23:30:00.000Z'));
  assert.equal(executable, true, 'target matching must ignore object key order');

  assert.equal(calls.filter((x) => x[0] === 'schema').length >= 4, true);

  assert.throws(() => createSupabaseApprovalAdapter(null), /supabase client must be injected/);
  assert.equal(await adapter.get(''), null);
  console.log('PASS: Supabase durable approval adapter tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
