'use strict';

const assert = require('node:assert/strict');
const {
  descriptor, endpointFor, upstreamModel, buildMessages, buildRequest,
  normalizeResponse, normalizeUsage, validateCredential, execute, MODEL, REGION
} = require('../execution/adapters/dashscope');

const route = {
  provider_id: 'alibaba_dashscope',
  account_id: 'acct_dashscope_primary',
  model_id: 'alibaba_dashscope/qwen3.8-max',
  route_type: 'direct',
  capability: 'text_generation'
};
const credential = JSON.stringify({
  api_key: 'sk-test-dashscope-only-placeholder',
  workspace_id: 'ws-test-123456',
  region: REGION,
  free_quota_only: true,
  free_quota_expires_at: '2099-01-01T00:00:00.000Z'
});

(async () => {
  assert.equal(descriptor.provider_id, 'alibaba_dashscope');
  assert.equal(descriptor.adapter_id, 'dashscope_openai_compatible');
  assert.equal(MODEL, 'qwen3.8-max');
  assert.equal(endpointFor('ws-test-123456'), 'https://ws-test-123456.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(endpointFor('bad workspace'), null);
  assert.equal(upstreamModel(route), 'qwen3.8-max');
  assert.equal(upstreamModel({ ...route, model_id: 'alibaba_dashscope/unlisted' }), null);
  assert.deepEqual(buildMessages({ prompt: 'hello' }), [{ role: 'user', content: 'hello' }]);
  assert.equal(buildMessages({}), null);
  assert.equal(validateCredential(credential, Date.parse('2026-11-01T00:00:00Z')).ok, true);
  assert.equal(require('../execution/adapters/dashscope').sanitizeProviderMessage('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer [REDACTED]');
  assert.equal(validateCredential(JSON.stringify({ ...JSON.parse(credential), free_quota_only: false })).reason, 'free_quota_only_not_confirmed');
  assert.equal(validateCredential(JSON.stringify({ ...JSON.parse(credential), free_quota_expires_at: '2020-01-01T00:00:00Z' }), Date.parse('2026-11-01T00:00:00Z')).reason, 'free_quota_expired_or_unknown');

  assert.deepEqual(buildRequest(route, { payload: { prompt: 'hello', max_tokens: 4000, temperature: 3, top_p: -1 } }), {
    model: MODEL, messages: [{ role: 'user', content: 'hello' }], max_tokens: 2048, temperature: 2, top_p: 0
  });
  assert.deepEqual(normalizeResponse({
    id: 'chatcmpl-test',
    model: MODEL,
    choices: [{ message: { role: 'assistant', content: 'world' }, finish_reason: 'stop' }]
  }), {
    modality: 'text', content: 'world', provider_response_id: 'chatcmpl-test',
    finish_reason: 'stop', provider_model: MODEL
  });
  assert.deepEqual(normalizeUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }), {
    status: 'reported', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3
  });

  let sent;
  const success = await execute({
    route, input: { payload: { prompt: 'hello', max_tokens: 64 } }, secret: credential,
    transport: async (url, options) => {
      sent = { url, options };
      return {
        status: 200,
        headers: { get: name => name === 'x-ratelimit-remaining-requests' ? '19' : null },
        json: { id: 'cmpl-test', model: MODEL, choices: [{ message: { content: 'ARIA_DASHSCOPE_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }
      };
    }
  });
  assert.equal(success.ok, true);
  assert.equal(sent.url, endpointFor('ws-test-123456'));
  assert.equal(sent.options.headers.Authorization, 'Bearer sk-test-dashscope-only-placeholder');
  assert.equal(JSON.parse(sent.options.body).max_tokens, 64);
  assert.equal(JSON.stringify(success).includes('sk-test-dashscope-only-placeholder'), false);
  assert.equal(success.metadata.free_quota_guard, 'free_quota_only');
  assert.equal(success.metadata.rate_limit['x-ratelimit-remaining-requests'], '19');

  const failed = await execute({
    route, input: { payload: { prompt: 'hello' } }, secret: credential,
    transport: async () => ({ status: 429, headers: { get: () => null }, json: { code: 'AllocationQuota.FreeTierOnly', message: 'quota depleted' } })
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.provider_status, 429);
  assert.equal(failed.error.provider_code, 'AllocationQuota.FreeTierOnly');

  const blocked = await execute({ route, input: { payload: { prompt: 'hello' } }, secret: JSON.stringify({ ...JSON.parse(credential), free_quota_only: false }), transport: async () => { throw new Error('must not run'); } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.message, 'free_quota_only_not_confirmed');

  console.log('dashscope-adapter.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
