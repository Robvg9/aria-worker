'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonMissionStore, createPersistentAutonomy } = require('../autonomy/persistent-control-plane-v1');
const { createPersistentHttpServer } = require('../autonomy/persistent-http-server-v1');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-http-v1-'));
  const token = 'test-token-with-at-least-32-characters-long';
  const store = createJsonMissionStore({ directory });
  const autonomy = createPersistentAutonomy({
    store,
    plan: async goal => [{ title: 'Execute: ' + goal, risk: 'low' }],
    executeTask: async task => ({ passed: true, evidence: { test: task.title } }),
    verifyCompletion: async mission => ({ passed: mission.tasks.every(task => task.status === 'succeeded') })
  });
  const app = createPersistentHttpServer({ store, autonomy, token, host: '127.0.0.1', port: 0, runSupervisor: false });
  try {
    const address = await app.listen();
    const base = 'http://127.0.0.1:' + address.port;
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).supabase_independent, true);
    const unauthorized = await fetch(base + '/api/missions');
    assert.equal(unauthorized.status, 401);
    const dashboard = await fetch(base + '/');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /ARIA Mission Control/);
    const createdResponse = await fetch(base + '/api/missions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'HTTP integration test' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.mission.goal, 'HTTP integration test');
    const listedResponse = await fetch(base + '/api/missions', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(listedResponse.status, 200);
    assert.equal((await listedResponse.json()).missions.length, 1);
    const malformed = await fetch(base + '/api/missions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{'
    });
    assert.equal(malformed.status, 400);
    process.stdout.write('persistent-http-server-v1: all tests passed\n');
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
