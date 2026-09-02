'use strict';

const assert = require('node:assert/strict');
const { observe, normalizeObservation } = require('../health/probe');

async function run() {
  const unknown = await observe({ provider_id: 'openrouter' });
  assert.equal(unknown.error, 'probe_not_configured');
  assert.equal(unknown.observation_valid, false);

  const observed = await observe(
    { provider_id: 'openrouter', model_id: 'google/gemini-2.5-flash-lite', account_id: 'acct_openrouter_primary' },
    async (filter) => ({
      health_status: 'healthy',
      availability_status: 'available',
      observed_at: '2026-09-02T12:00:00.000Z',
      source: 'injected-test-probe',
      evidence_ref: 'evidence_1',
      last_error: null,
      echoed_provider: filter.provider_id
    })
  );
  assert.equal(observed.observation_valid, true);
  assert.equal(observed.health.status, 'healthy');
  assert.equal(observed.availability.status, 'available');
  assert.equal(observed.health.source, 'injected-test-probe');
  assert.equal(observed.health.evidence_ref, 'evidence_1');
  assert.equal(observed.provider_id, 'openrouter');
  assert.equal(observed.model_id, 'google/gemini-2.5-flash-lite');
  assert.equal(observed.account_id, 'acct_openrouter_primary');

  const malformed = normalizeObservation(
    { provider_id: 'openrouter' },
    { health_status: 'banana', availability_status: 'nope', observed_at: 'never' }
  );
  assert.equal(malformed.observation_valid, false);
  assert.equal(malformed.error, 'insufficient_evidence');

  const sanitized = normalizeObservation(
    { provider_id: 'openrouter' },
    {
      health_status: 'degraded',
      availability_status: 'unavailable',
      observed_at: '2026-09-02T12:00:00.000Z',
      source: 'test',
      evidence_ref: 'evidence_2',
      last_error: 'Bearer SUPERSECRET'
    }
  );
  assert.equal(sanitized.health.last_error, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(sanitized), /SUPERSECRET/);

  const thrown = await observe({ provider_id: 'openrouter' }, async () => {
    throw new Error('Bearer secret_abc123456');
  });
  assert.equal(thrown.observation_valid, false);
  assert.match(thrown.error, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(thrown), /secret_abc123456/);

  console.log('PASS: health observation boundary tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
