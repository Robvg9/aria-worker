'use strict';

// Cloud-side persistent coordinator. All model calls and workspace execution
// happen on the authenticated Windows worker; this process owns the durable ledger.
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  createJsonMissionStore,
  createPersistentAutonomy
} = require('../autonomy/persistent-control-plane-v1');
const {
  createPersistentWorkerBridge,
  createWorkerBackedExecutor,
  createWorkerBackedPlanner,
  createWorkerBackedReplanner,
  createWorkerBackedVerifier
} = require('../autonomy/persistent-worker-bridge-v1');
const { createPersistentHttpServer } = require('../autonomy/persistent-http-server-v1');
const { createPersistentNotifier } = require('../autonomy/persistent-notifications-v1');

async function main() {
  const directory = path.resolve(process.env.ARIA_MISSION_DATA_DIR || path.join(process.cwd(), '.aria-missions'));
  const token = process.env.ARIA_CONTROL_TOKEN || '';
  const workerToken = process.env.ARIA_WORKER_TOKEN || '';
  if (token.length < 32) throw new Error('Set ARIA_CONTROL_TOKEN to a random secret of at least 32 characters.');
  if (workerToken.length < 32 || workerToken === token) throw new Error('Set ARIA_WORKER_TOKEN to a separate random secret of at least 32 characters.');
  await fs.mkdir(directory, { recursive: true });

  const store = createJsonMissionStore({ directory });
  const bridge = createPersistentWorkerBridge({
    directory,
    leaseMs: Math.max(5000, Number(process.env.ARIA_WORKER_LEASE_MS || 60000))
  });
  const notifier = createPersistentNotifier({ directory });
  const taskTimeout = Math.max(30000, Number(process.env.ARIA_WORKER_TASK_TIMEOUT_MS || 1800000));
  const plan = createWorkerBackedPlanner({ bridge, timeoutMs: taskTimeout });
  const replan = createWorkerBackedReplanner({ bridge, timeoutMs: taskTimeout });
  const executeTask = createWorkerBackedExecutor({ bridge, timeoutMs: taskTimeout });
  const verifyCompletion = createWorkerBackedVerifier({ bridge, timeoutMs: taskTimeout });
  const autonomy = createPersistentAutonomy({
    store, plan, replan, executeTask, verifyCompletion, notify: notifier.notify
  });
  const app = createPersistentHttpServer({
    store, autonomy, token,
    host: process.env.ARIA_CONTROL_HOST || '127.0.0.1',
    port: Number(process.env.ARIA_CONTROL_PORT || 8787),
    runSupervisor: true,
    workerBridge: bridge,
    workerToken,
    notifier,
    notify: notifier.notify
  });
  const address = await app.listen();
  void notifier.run();
  process.stdout.write('ARIA hybrid coordinator listening at http://' + address.host + ':' + address.port + '\n');
  process.stdout.write('Mission ledger: ' + directory + '\n');
  process.stdout.write('Planning/execution: authenticated Windows worker; Supabase-independent.\n');
  let closing = false;
  async function stop() {
    if (closing) return;
    closing = true;
    await app.close();
    await notifier.stop();
    process.exit(0);
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(error => {
  process.stderr.write('ARIA hybrid coordinator failed to start: ' + String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
