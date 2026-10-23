'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPersistentNotifier } = require('../autonomy/persistent-notifications-v1');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-notify-v1-'));
  try {
    const unconfigured = createPersistentNotifier({ directory });
    const waiting = await unconfigured.notify({ type: 'human_intervention_required', mission_id: 'mission_a' });
    assert.equal(waiting.status, 'waiting_config');
    assert.equal((await unconfigured.list()).length, 1);

    let sentBody;
    const notifier = createPersistentNotifier({
      directory,
      webhookUrl: 'https://notify.example.test/aria',
      token: 'notification-token',
      fetchImpl: async (_url, options) => {
        sentBody = JSON.parse(options.body);
        assert.equal(options.headers.authorization, 'Bearer notification-token');
        return { ok: true, status: 200 };
      }
    });
    const recovered = await notifier.flush();
    assert.equal(recovered.some(item => item.notification_id === waiting.notification_id && item.status === 'delivered'), true);
    const delivered = await notifier.notify({ type: 'mission_completed', mission_id: 'mission_b', details: 'verified' });
    assert.equal(delivered.status, 'delivered');
    assert.equal(sentBody.type, 'mission_completed');
    assert.equal(sentBody.mission_id, 'mission_b');
    assert.equal(JSON.stringify(sentBody).includes('notification-token'), false);
    assert.equal((await notifier.list()).some(item => item.status === 'delivered'), true);
    process.stdout.write('persistent-notifications-v1: all tests passed\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
