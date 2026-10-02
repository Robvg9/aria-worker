'use strict';

const assert = require('assert');
const {
  descriptor,
  buildMessages,
  buildRequest,
  normalizeResponse,
  normalizeUsage,
  execute
} = require('../execution/adapters/mistral');

assert.strictEqual(descriptor.provider_id, 'mistral');
assert.strictEqual(descriptor.adapter_id, 'mistral_chat_completions');
assert.deepStrictEqual(buildMessages({ prompt: 'hello' }), [
  { role: 'user', content: 'hello' }
]);
assert.deepStrictEqual(buildMessages({
  messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }]
}), [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'yo' }
]);
assert.strictEqual(buildMessages({}), null);

const route = {
  provider_id: 'mistral',
  capability: 'text_generation',
  model_id: 'mistral/mistral-small-latest',
  route_type: 'direct'
};
const req = buildRequest(route, {
  payload: {
    prompt: 'hello',
    max_tokens: 42,
    temperature: 0.2,
    top_p: 0.8
  }
});
assert.deepStrictEqual(req, {
  model: 'mistral-small-latest',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 42,
  temperature: 0.2,
  top_p: 0.8
});

const normalized = normalizeResponse({
  id: 'cmpl-test',
  model: 'mistral-small-latest',
  choices: [{
    message: { role: 'assistant', content: 'hello' },
    finish_reason: 'stop'
  }]
});
assert.deepStrictEqual(normalized, {
  modality: 'text',
  content: 'hello',
  provider_response_id: 'cmpl-test',
  finish_reason: 'stop',
  provider_model: 'mistral-small-latest'
});
assert.strictEqual(normalizeResponse({ choices: [] }), null);

assert.deepStrictEqual(normalizeUsage({
  prompt_tokens: 1,
  completion_tokens: 2,
  total_tokens: 3
}), {
  status: 'reported',
  prompt_tokens: 1,
  completion_tokens: 2,
  total_tokens: 3
});

let observed;
execute({
  route,
  input: { payload: { prompt: 'hello' } },
  secret: 'test-only-secret',
  transport: async (url, options) => {
    observed = { url, options };
    return {
      status: 200,
      json: {
        id: 'cmpl-live-shape',
        model: 'mistral-small-latest',
        choices: [{ message: { role: 'assistant', content: 'world' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
      }
    };
  }
}).then(result => {
  assert.ok(result.ok);
  assert.strictEqual(observed.url, 'https://api.mistral.ai/v1/chat/completions');
  assert.strictEqual(observed.options.headers.Authorization, 'Bearer test-only-secret');
  assert.strictEqual(JSON.parse(observed.options.body).model, 'mistral-small-latest');
  assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  assert.strictEqual(result.response.content, 'world');
  console.log('mistral adapter tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
