'use strict';

const assert = require('assert');
const { createMissionHttpHandler } = require('../autonomy/mission-http');

function request(method, body) {
  return new Request('https://aria.test/mission', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

(async () => {
  assert.throws(() => createMissionHttpHandler(), /startMission function required/);

  let calls = [];
  const handler = createMissionHttpHandler({
    startMission: async (input) => {
      calls.push(input);
      return { mission: { mission_id: 'm1' }, result: { status: 'succeeded' } };
    }
  });

  const getResult = await handler(new Request('https://aria.test/mission', { method: 'GET' }));
  assert.strictEqual(getResult.status, 405);

  const badJson = await handler(new Request('https://aria.test/mission', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  }));
  assert.strictEqual(badJson.status, 400);
  assert.strictEqual((await badJson.json()).error, 'invalid_json');

  const noGoal = await handler(request('POST', {}));
  assert.strictEqual(noGoal.status, 400);
  assert.strictEqual((await noGoal.json()).error, 'goal_required');

  const ok = await handler(request('POST', {
    goal: 'build an application',
    metadata: { source: 'test' }
  }));
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await ok.json()).ok, true);
  assert.strictEqual(calls[0].goal, 'build an application');

  let queueCalls = 0;
  let startCalls = 0;
  const queuedHandler = createMissionHttpHandler({
    startMission: async () => {
      startCalls += 1;
      return { mission: { mission_id: 'wrong-start' } };
    },
    queueMission: async (input) => {
      queueCalls += 1;
      return { mission: { mission_id: 'queued-1', goal: input.goal, status: 'queued' }, result: { status: 'queued', execution_started: false } };
    }
  });
  const queued = await queuedHandler(request('POST', { goal: 'queue an application' }));
  assert.strictEqual(queued.status, 200);
  assert.strictEqual((await queued.json()).mission.mission_id, 'queued-1');
  assert.strictEqual(queueCalls, 1);
  assert.strictEqual(startCalls, 0);

  const protectedHandler = createMissionHttpHandler({
    auth: async () => false,
    startMission: async () => ({})
  });
  const unauthorized = await protectedHandler(request('POST', { goal: 'x' }));
  assert.strictEqual(unauthorized.status, 401);

  console.log('Mission HTTP entrypoint: PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});