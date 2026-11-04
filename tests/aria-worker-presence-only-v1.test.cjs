'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const workerPath = path.join(__dirname, '..', 'scripts', 'aria-worker-presence-only-v1.js');
const TOKEN = 'presence-only-worker-token'.padEnd(48, 'w');
const SCOPE_TOKEN = crypto.randomBytes(48).toString('base64url');
const PROBE_ID = 'a3-presence-unit-0001';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

function runWorker(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

(async () => {
  let calls = 0;
  const routes = [];
  const server = http.createServer((req, res) => {
    routes.push(req.url);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      calls += 1;
      const headers = req.headers;
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/api/worker/presence');
      assert.equal(headers.authorization, 'Bearer ' + TOKEN);
      assert.equal(headers['x-aria-worker-presence-probe-id'], PROBE_ID);
      assert.equal(headers['x-aria-worker-presence-scope-token'], SCOPE_TOKEN);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.worker_id, 'ROBVG-a3-presence-fixture');
      assert.equal(body.state, 'idle');
      assert.ok(body.instance_id);
      if (calls === 1) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'temporary_coordinator_unavailable' }));
      } else if (calls === 2) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, presence_count: 1 }));
      } else {
        res.writeHead(410, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'worker_presence_scope_expired' }));
      }
    });
  });

  try {
    const port = await listen(server);
    const result = await runWorker({
      ARIA_CONTROL_URL: 'http://127.0.0.1:' + port,
      ARIA_WORKER_TOKEN: TOKEN,
      ARIA_WORKER_ID: 'ROBVG-a3-presence-fixture',
      ARIA_WORKER_PRESENCE_PROBE_ID: PROBE_ID,
      ARIA_WORKER_PRESENCE_SCOPE_TOKEN: SCOPE_TOKEN,
      ARIA_WORKER_PRESENCE_INSTANCE_ID: 'instance-a3-test-0001',
      ARIA_WORKER_PRESENCE_INTERVAL_MS: '1000',
      ARIA_WORKER_PRESENCE_RETRY_BASE_MS: '100'
    });
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(calls, 3);
    assert.deepEqual(routes, [
      '/api/worker/presence',
      '/api/worker/presence',
      '/api/worker/presence'
    ]);
    assert.match(result.stdout, /ARIA_WINDOWS_PRESENCE_WORKER_STARTED=true/);
    assert.match(result.stdout, /ARIA_WINDOWS_WORKER_HEARTBEAT=PASS; COUNT=1/);
    assert.match(result.stdout, /ARIA_WINDOWS_PRESENCE_WORKER_STOPPED=SCOPE_REVOKED_OR_EXPIRED/);
    assert.match(result.stderr, /ARIA_WINDOWS_PRESENCE_RETRY=1; DELAY_MS=100/);
    assert.doesNotMatch(result.stdout + result.stderr, /\/api\/worker\/claim|\/api\/worker\/jobs|mission_id|job_id/i);
    process.stdout.write('A3_PRESENCE_WORKER_ROUTE_ONLY=PASS\n');
    process.stdout.write('A3_PRESENCE_TRANSIENT_RETRY_BACKOFF=PASS\n');
    process.stdout.write('A3_PRESENCE_SCOPE_EXPIRY_CLEAN_STOP=PASS\n');
  } finally {
    await close(server);
  }
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
