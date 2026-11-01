'use strict';

const assert = require('node:assert/strict');
const {
  descriptor,
  buildMessages,
  buildRequest,
  normalizeResponse,
  normalizeUsage,
  execute,
  ENDPOINT
} = require('../execution/adapters/groq');

(async () => {
  assert.equal(descriptor.provider_id, 'groq');
  assert.equal(descriptor.adapter_id, 'groq_chat_completions');
  assert.equal(ENDPOINT, 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepEqual(buildMessages({ prompt: 'hello' }), [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(buildMessages({ messages: [{ role: 'user', content: 'hello' }] }), [{ role: 'user', content: 'hello' }]);
  assert.equal(buildMessages({}), null);

  const route = {
    provider_id: 'groq',
    account_id: 'acct_groq_primary',
    model_id: 'groq/openai/gpt-oss-120b',
    upstream_model: 'openai/gpt-oss-120b',
    capability: 'text_generation',
    route_type: 'direct'
  };
  assert.deepEqual(buildRequest(route, {
    payload: { prompt: 'test', max_completion_tokens: 64, temperature: 0.2, top_p: 0.8 }
  }), {
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'test' }],
    max_completion_tokens: 64,
    temperature: 0.2,
    top_p: 0.8
  });

  assert.deepEqual(normalizeResponse({
    id: 'chatcmpl-test',
    model: 'openai/gpt-oss-120b',
    choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }]
  }), {
    modality: 'text',
    content: 'hello',
    provider_response_id: 'chatcmpl-test',
    finish_reason: 'stop',
    provider_model: 'openai/gpt-oss-120b'
  });
  assert.equal(normalizeResponse({ choices: [] }), null);
  assert.deepEqual(normalizeUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }), {
    status: 'reported', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3
  });

  const syntheticKey = 'gsk_test_only_never_real';
  let sent;
  const success = await execute({
    route,
    input: { payload: { prompt: 'test' } },
    secret: syntheticKey,
    transport: async (url, options) => {
      sent = { url, options };
      return {
        status: 200,
        json: {
          id: 'chatcmpl-live-shape',
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { role: 'assistant', content: 'world' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        }
      };
    }
  });
  assert.equal(success.ok, true);
  assert.equal(sent.url, ENDPOINT);
  assert.equal(sent.options.headers.Authorization, 'Bearer ' + syntheticKey);
  assert.equal(JSON.parse(sent.options.body).model, 'openai/gpt-oss-120b');
  assert.equal(JSON.stringify(success).includes(syntheticKey), false);
  assert.equal(success.response.content, 'world');

  const limited = await execute({
    route,
    input: { payload: { prompt: 'test' } },
    secret: syntheticKey,
    transport: async () => ({
      status: 429,
      json: { error: { message: 'rate limit reached gsk_should_not_leak_123456789' } }
    })
  });
  assert.equal(limited.ok, false);
  assert.equal(limited.error.provider_status, 429);
  assert.equal(limited.error.message.includes('gsk_should_not_leak_123456789'), false);

  console.log('groq-adapter.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
