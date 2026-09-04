'use strict';

const assert = require('assert');
const { createDeviceDispatcher } = require('../execution/device-dispatcher');

(async () => {
  const jobs = new Map();
  const dispatcher = createDeviceDispatcher({
    enqueue: async job => { jobs.set(job.job_id, { ...job, status: 'queued' }); return jobs.get(job.job_id); },
    get: async id => jobs.get(id),
    sleep: async () => {}
  });

  const pending = dispatcher.execute({
    missionId: 'm1',
    step: { id: 's1', operation: 'shell.execute', target: { device_id: 'android-termux-test' }, input: { command: 'echo ok' } },
    attempt: 1
  });

  await Promise.resolve();
  const id = [...jobs.keys()][0];
  assert.ok(id);
  jobs.get(id).status = 'succeeded';
  jobs.get(id).exit_code = 0;
  jobs.get(id).result = { duration_ms: 5 };
  const result = await pending;
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(result.exit_code, 0);

  const failDispatcher = createDeviceDispatcher({
    enqueue: async job => ({ ...job, status: 'queued' }),
    get: async () => ({ status: 'failed', exit_code: 7, stdout: '', stderr: 'nope' }),
    sleep: async () => {}
  });
  const failed = await failDispatcher.execute({
    missionId: 'm2',
    step: { id: 's2', operation: 'shell.execute', target: { device_id: 'android-termux-test' }, input: { command: 'false' } },
    attempt: 1
  });
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.exit_code, 7);

  const waitTimeout = createDeviceDispatcher({
    enqueue: async job => ({ ...job, status: 'queued' }),
    get: async () => ({ status: 'running' }),
    sleep: async () => {},
    wait_ms: 1
  });
  const timed = await waitTimeout.execute({
    missionId: 'm3',
    step: { id: 's3', operation: 'shell.execute', target: { device_id: 'android-termux-test' }, input: { command: 'sleep 10' } },
    attempt: 1
  });
  assert.strictEqual(timed.status, 'timeout');

  console.log('device dispatcher tests passed');
})().catch(error => { console.error(error); process.exit(1); });
