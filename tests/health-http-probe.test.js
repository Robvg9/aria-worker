'use strict';

const assert = require('node:assert/strict');
const { validateTarget, normalizeStatus, probeHttp } = require('../health/http-probe');

async function run() {
  assert.equal(validateTarget({ url: 'https://example.com', method: 'GET' }).valid, true);
  assert.equal(validateTarget({ url: 'http://example.com', method: 'GET' }).reason, 'https_required');
  assert.equal(validateTarget({ url: 'https://example.com', method: 'POST' }).reason, 'method_not_allowed');
  assert.deepEqual(normalizeStatus(200), { health_status: 'healthy', availability_status: 'available' });
  assert.deepEqual(normalizeStatus(503), { health_status: 'unavailable', availability_status: 'unavailable' });
  assert.deepEqual(normalizeStatus(429), { health_status: 'degraded', availability_status: 'unavailable' });

  const fakeFetch = async () => ({ status: 204 });
  const ok = await probeHttp({ url: 'https://example.com/health', method: 'GET' }, { fetch: fakeFetch });
  assert.equal(ok.ok, true);
  assert.equal(ok.health_status, 'healthy');
  assert.equal(ok.availability_status, 'available');
  assert.equal(ok.source, 'http_probe');

  const failed = await probeHttp({ url: 'https://example.com/health', method: 'HEAD' }, {
    fetch: async () => { throw new Error('network failed'); }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.health_status, 'unknown');
  assert.equal(failed.availability_status, 'unknown');

  const timed = await probeHttp({ url: 'https://example.com/health' }, {
    timeout_ms: 1,
    fetch: (_url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })
  });
  assert.equal(timed.ok, false);
  assert.equal(timed.error, 'probe_timeout');

  const redirect = await probeHttp({ url: 'https://example.com' }, {
    fetch: async () => ({ status: 302 })
  });
  assert.equal(redirect.availability_status, 'available');

  console.log('PASS: HTTP health probe boundary tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
