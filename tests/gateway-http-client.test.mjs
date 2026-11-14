import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGatewayRequest } = require('../agents/windows/gateway-http-client.cjs');

const server = http.createServer((req, res) => {
  if (req.url === '/ok') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (req.url === '/truncated') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '64' });
    res.write('{"partial":');
    setTimeout(() => res.socket?.destroy(), 10);
    return;
  }

  if (req.url === '/slow') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

const listen = async () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject);
    resolve(server.address().port);
  });
});

const rejectsWithoutHanging = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '_hung')), 2_500); })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

try {
  const port = await listen();
  const request = createGatewayRequest({ https: http, defaultTimeoutMs: 1_000, maxResponseBytes: 256 });
  const base = `http://127.0.0.1:${port}`;

  const ok = await request(base + '/ok');
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.text).ok, true);
  assert.equal(ok.diagnostics.phase, 'complete');
  assert.equal(Number.isFinite(ok.diagnostics.elapsed_ms), true);
  assert.ok(Array.isArray(ok.diagnostics.phase_history));

  await assert.rejects(
    () => rejectsWithoutHanging(request(base + '/truncated'), 'truncated_response'),
    error => ['gateway_response_aborted', 'gateway_response_incomplete', 'ECONNRESET'].includes(error.code) && error.phase === 'response_body' && Number.isFinite(error.elapsed_ms)
  );

  await assert.rejects(
    () => rejectsWithoutHanging(request(base + '/slow', { timeoutMs: 1_000 }), 'hard_deadline'),
    error => error.code === 'gateway_timeout' && error.phase === 'response_body' && ['hard_deadline', 'socket_inactivity'].includes(error.timeout_kind) && Number.isFinite(error.elapsed_ms)
  );

  const dnsFailureRequest = createGatewayRequest({
    https: http,
    lookup: (_hostname, _options, callback) => {
      const error = new Error('simulated DNS failure');
      error.code = 'EAI_AGAIN';
      callback(error);
    },
    defaultTimeoutMs: 1_000
  });
  await assert.rejects(
    () => rejectsWithoutHanging(dnsFailureRequest('http://gateway.invalid/ok'), 'dns_failure'),
    error => error.code === 'EAI_AGAIN' && error.phase === 'dns_lookup_failed' && Number.isFinite(error.elapsed_ms)
  );

  console.log('A6_GATEWAY_HTTP_COMPLETE_RESPONSE=PASS');
  console.log('A6_GATEWAY_HTTP_TRUNCATED_RESPONSE_REJECTED=PASS');
  console.log('A6_GATEWAY_HTTP_HARD_DEADLINE=PASS');
  console.log('A6_GATEWAY_HTTP_DNS_PHASE_DIAGNOSTIC=PASS');
} finally {
  await new Promise(resolve => server.close(() => resolve()));
}
