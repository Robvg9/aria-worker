'use strict';

// Standalone launcher for the Supabase-independent persistent control plane.
// The adapter must explicitly declare supabaseIndependent: true and provide
// plan(goal, context), executeTask(task, mission, context), verifyCompletion(mission).
const fs = require('node:fs/promises');
const path = require('node:path');
const { createJsonMissionStore, createPersistentAutonomy } = require('../autonomy/persistent-control-plane-v1');
const { createPersistentHttpServer } = require('../autonomy/persistent-http-server-v1');

async function main() {
  const adapterPath = process.env.ARIA_AUTONOMY_ADAPTER;
  if (!adapterPath) throw new Error('Set ARIA_AUTONOMY_ADAPTER to an approved Supabase-independent adapter module.');
  const resolvedAdapterPath = path.resolve(adapterPath);
  const adapter = require(resolvedAdapterPath);
  if (adapter.supabaseIndependent !== true) throw new Error('Adapter must export supabaseIndependent: true.');
  for (const name of ['plan', 'executeTask', 'verifyCompletion']) {
    if (typeof adapter[name] !== 'function') throw new Error('Adapter must export function ' + name + '.');
  }
  const token = process.env.ARIA_CONTROL_TOKEN;
  if (typeof token !== 'string' || token.length < 32) throw new Error('Set ARIA_CONTROL_TOKEN to a random secret of at least 32 characters.');
  const directory = path.resolve(process.env.ARIA_MISSION_DATA_DIR || path.join(process.cwd(), '.aria-missions'));
  await fs.mkdir(directory, { recursive: true });
  const store = createJsonMissionStore({ directory });
  const autonomy = createPersistentAutonomy({
    store,
    plan: adapter.plan,
    executeTask: adapter.executeTask,
    verifyCompletion: adapter.verifyCompletion,
    replan: typeof adapter.replan === 'function' ? adapter.replan : null,
    notify: typeof adapter.notify === 'function' ? adapter.notify : async () => {}
  });
  const app = createPersistentHttpServer({
    store, autonomy, token,
    host: process.env.ARIA_CONTROL_HOST || '127.0.0.1',
    port: Number(process.env.ARIA_CONTROL_PORT || 8787),
    runSupervisor: true,
    notify: typeof adapter.notify === 'function' ? adapter.notify : async () => {}
  });
  const address = await app.listen();
  process.stdout.write('ARIA persistent autonomy listening at http://' + address.host + ':' + address.port + '\n');
  process.stdout.write('Mission ledger: ' + directory + '\n');
  process.stdout.write('Supabase-independent mode: enabled\n');
  let closing = false;
  async function stop() {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(error => {
  process.stderr.write('ARIA persistent autonomy failed to start: ' + String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
