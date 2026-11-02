'use strict';

const assert = require('node:assert/strict');
const {
  deriveCloudflarePlanProducerToken,
  buildCloudflareWorkspacePlan
} = require('../supabase/functions/aria-planner-v11/cloudflare-workspace-plan-v1.mjs');

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; }
  async get(key) {
    const value = this.values.get(key);
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  async put(key, value) { this.values.set(key, JSON.parse(JSON.stringify(value))); }
  async list({ prefix = '' } = {}) {
    return new Map(Array.from(this.values.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
  }
  async setAlarm(value) { this.alarmAt = value; }
}

async function api(store, route, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return store.fetch(new Request('https://coordinator.test' + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

(async () => {
  const { AriaMissionStore, MISSION_EXECUTION_PAUSED } =
    await import('../cloudflare-autonomy/worker.mjs');
  assert.equal(MISSION_EXECUTION_PAUSED, true);

  const controlToken = 'remote-plan-control-token'.padEnd(48, 'c');
  const workerToken = 'remote-plan-worker-token'.padEnd(48, 'w');
  const sharedSecretFixture = 'remote-plan-test-secret'.padEnd(48, 's');
  const producerToken = await deriveCloudflarePlanProducerToken(sharedSecretFixture);
  const requests = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body), redirect: init.redirect });
    const spec = requests[requests.length - 1].body.context.cloudflare_workspace_request;
    const operation = spec.allowed_operations[0];
    const tasks = operation === 'workspace.write'
      ? [{
          task_id: 'guarded_write',
          operation,
          payload: { path: 'tmp/guarded-proof.txt', content: 'must wait for approval\\n' },
          depends_on: []
        }]
      : [{ task_id: 'repo_status', operation, payload: {}, depends_on: [] }];
    const plan = buildCloudflareWorkspacePlan(
      requests[requests.length - 1].body.goal,
      spec,
      JSON.stringify({ tasks })
    );
    return new Response(JSON.stringify({
      ok: true,
      plan: { goal: plan.goal, tasks: plan.tasks },
      planner_version: plan.planner_version,
      contract_version: plan.contract_version,
      requires_human_approval_for_mutations: plan.requires_human_approval_for_mutations,
      model: {
        provider_id: 'openrouter',
        account_id: 'acct_openrouter_primary',
        model_id: 'nvidia/nemotron-3.5-lightning:free',
        executor: 'aria-execution-runtime-v1'
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const state = { storage: new MemoryStorage(), waitUntil() {} };
    const store = new AriaMissionStore(state, {
      ARIA_CONTROL_TOKEN: controlToken,
      ARIA_WORKER_TOKEN: workerToken,
      ARIA_PLAN_PRODUCER_TOKEN: producerToken,
      ARIA_PLAN_PRODUCER_URL: 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-planner-v11',
      ARIA_ALARM_INTERVAL_MS: '5000'
    });

    const requestSpec = {
      version: 'v1',
      allowed_operations: ['git.status'],
      workspace_context: { root: 'workspace' }
    };

    // The read-only planner preview is available while the global mission freeze is active.
    const preview = await api(store, '/api/plan-preview', {
      method: 'POST',
      token: controlToken,
      body: { goal: 'Inspect repository status', cloudflare_workspace_request: requestSpec }
    });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json();
    assert.equal(previewBody.source, 'supabase:aria-planner-v11');
    assert.equal(previewBody.tasks[0].operation, 'git.status');
    assert.equal(previewBody.model.model_id, 'nvidia/nemotron-3.5-lightning:free');
    assert.equal(previewBody.model.executor, 'aria-execution-runtime-v1');
    assert.equal(previewBody.durable_state_mutated, false);
    assert.equal(previewBody.requires_human_approval_for_mutations, false);
    assert.equal(state.storage.values.size, 0, 'plan preview must not create Durable Object records');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.get('x-aria-plan-producer'), 'cloudflare-workspace-v1');
    assert.equal(requests[0].headers.get('x-aria-plan-producer-token'), producerToken);
    assert.equal(requests[0].headers.get('authorization'), null, 'root Supabase credentials must not be forwarded');

    // Redirects are surfaced by status only; producer credentials are never forwarded to a redirect target.
    const successFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init = {}) => {
      assert.equal(init.redirect, 'manual');
      return new Response('redirect target must not be exposed', {
        status: 307,
        headers: { location: 'https://sensitive.example/redirect-target' }
      });
    };
    try {
      const redirectPreview = await api(store, '/api/plan-preview', {
        method: 'POST',
        token: controlToken,
        body: { goal: 'Inspect repository status', cloudflare_workspace_request: requestSpec }
      });
      assert.equal(redirectPreview.status, 503);
      const redirectBody = await redirectPreview.json();
      assert.equal(redirectBody.error, 'remote_plan_producer_redirect_307');
      assert.equal(JSON.stringify(redirectBody).includes('sensitive.example'), false);
      assert.equal(JSON.stringify(redirectBody).includes('redirect target'), false);
    } finally {
      globalThis.fetch = successFetch;
    }

    // Transport diagnostics expose only a small allowlist, never the error message, URL or credentials.
    const successFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const failure = new TypeError('sensitive transport message must never be returned');
      failure.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
      throw failure;
    };
    try {
      const unreachablePreview = await api(store, '/api/plan-preview', {
        method: 'POST',
        token: controlToken,
        body: { goal: 'Inspect repository status', cloudflare_workspace_request: requestSpec }
      });
      assert.equal(unreachablePreview.status, 503);
      const unreachableBody = await unreachablePreview.json();
      assert.equal(unreachableBody.error, 'remote_plan_producer_unreachable_typeerror_und_err_connect_timeout');
      assert.equal(JSON.stringify(unreachableBody).includes('sensitive transport message'), false);
      assert.equal(JSON.stringify(unreachableBody).includes('icuqsstxfdbvjytkhlog'), false);
    } finally {
      globalThis.fetch = successFetch;
    }

    // Neither the control token nor the worker token may submit a remote plan.
    const controlCannotSubmit = await api(store, '/api/missions/mission_fake/plan', {
      method: 'POST',
      token: controlToken,
      body: { tasks: [] }
    });
    assert.equal(controlCannotSubmit.status, 401);
    const workerCannotSubmit = await api(store, '/api/missions/mission_fake/plan', {
      method: 'POST',
      token: workerToken,
      body: { tasks: [] }
    });
    assert.equal(workerCannotSubmit.status, 401);

    // The dedicated producer token authenticates, but the production freeze still blocks mutation.
    const frozenSubmit = await api(store, '/api/missions/mission_fake/plan', {
      method: 'POST',
      token: producerToken,
      body: { tasks: [] }
    });
    assert.equal(frozenSubmit.status, 423);
    const frozenCreate = await api(store, '/api/missions', {
      method: 'POST',
      token: controlToken,
      body: { goal: 'This normal mission must remain paused' }
    });
    assert.equal(frozenCreate.status, 423);
    assert.equal(state.storage.values.size, 0);

    // Contract-only integration test with the freeze overridden in memory.
    // Production MISSION_EXECUTION_PAUSED remains true.
    store.isMissionExecutionPaused = () => false;
    const created = await api(store, '/api/missions', {
      method: 'POST',
      token: controlToken,
      body: {
        goal: 'Inspect this workspace through the canonical remote plan producer',
        metadata: { cloudflare_workspace_request: requestSpec },
        policy: { max_risk: 'low', require_human_approval: true, max_steps: 1 }
      }
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.mission.status, 'running');
    assert.equal(createdBody.mission.tasks.length, 1);
    assert.equal(createdBody.mission.tasks[0].task_id, 'repo_status');
    assert.equal(requests.length, 2, 'mission creation must call the canonical planner exactly once');
    assert.equal(requests[1].body.goal, 'Inspect this workspace through the canonical remote plan producer');

    const jobs = await state.storage.list({ prefix: 'job:' });
    const obsoletePlanJob = Array.from(jobs.values()).find(job =>
      job.mission_id === createdBody.mission.mission_id && job.operation === 'mission.plan'
    );
    assert.ok(obsoletePlanJob);
    assert.equal(obsoletePlanJob.status, 'cancelled');
    assert.equal(obsoletePlanJob.last_error, 'superseded_by_authenticated_remote_plan');

    const eventRecords = await state.storage.list({ prefix: 'event:' + createdBody.mission.mission_id + ':' });
    const eventTypes = Array.from(eventRecords.values()).map(event => event.type);
    assert.ok(eventTypes.includes('mission_plan_submitted'));

    // A caller cannot lower the human gate for a mutating workspace plan.
    const writeRequest = {
      version: 'v1',
      allow_mutations: true,
      allowed_operations: ['workspace.write'],
      // Legacy mutation-policy hint; task payload itself is generated by the remote model.
      tasks: [{ operation: 'workspace.write' }],
      workspace_context: { approved_scope: 'temporary proof file only' }
    };
    const guardedWrite = await api(store, '/api/missions', {
      method: 'POST',
      token: controlToken,
      body: {
        goal: 'Create a guarded workspace proof file',
        metadata: { cloudflare_workspace_request: writeRequest },
        policy: { max_risk: 'critical', require_human_approval: false, max_steps: 1 }
      }
    });
    assert.equal(guardedWrite.status, 201);
    const guardedWriteMission = (await guardedWrite.json()).mission;
    assert.equal(guardedWriteMission.status, 'waiting_human');
    assert.equal(guardedWriteMission.policy.max_risk, 'low');
    assert.equal(guardedWriteMission.policy.require_human_approval, true);
    assert.equal(guardedWriteMission.approval.status, 'pending');
    assert.equal(guardedWriteMission.tasks[0].status, 'waiting_human');
    process.stdout.write('CLOUDFLARE_REMOTE_PLAN_PREVIEW_FROZEN=PASS\n');
    process.stdout.write('CLOUDFLARE_REMOTE_PLAN_PRODUCER_AUTH=PASS\n');
    process.stdout.write('CLOUDFLARE_REMOTE_PLAN_CREATE_AND_SUBMIT_CONTRACT=PASS\n');
  } finally {
    globalThis.fetch = priorFetch;
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
