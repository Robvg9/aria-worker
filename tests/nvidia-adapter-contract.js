'use strict';

const assert = require('node:assert/strict');
const { descriptor, buildRequest, normalizeResponse, normalizeUsage, execute } = require('../execution/adapters/nvidia');

assert.equal(descriptor.provider_id, 'nvidia');
assert.equal(descriptor.route_type, 'catalog');
assert.equal(descriptor.endpoint, 'https://integrate.api.nvidia.com/v1/chat/completions');

const route = {
  provider_id: 'nvidia',
  route_type: 'catalog',
  capability: 'text_generation',
  model_id: 'z-ai/glm-5-3-flash'
};

const req = buildRequest(route, {
  payload: {
    prompt: 'hello',
    max_tokens: 32,
    temperature: 0,
    reasoning_effort: 'medium',
    tools: [{ type: 'function', function: { name: 'demo' } }]
  }
});

assert.equal(req.model, 'z-ai/glm-5-3-flash');
assert.equal(req.messages[0].content, 'hello');
assert.equal(req.max_tokens, 32);
assert.equal(req.temperature, 0);
assert.equal(req.reasoning_effort, 'medium');
assert.equal(req.tools.length, 1);

const normalized = normalizeResponse({
  id: 'nvidia-test-1',
  model: 'z-ai/glm-5-3-flash',
  choices: [{
    message: {
      content: 'hello world',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'demo', arguments: '{}' } }]
    },
    finish_reason: 'stop'
  }],
  usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
});

assert.equal(normalized.content, 'hello world');
assert.equal(normalized.tool_calls.length, 1);
assert.equal(normalized.provider_response_id, 'nvidia-test-1');
assert.equal(normalized.finish_reason, 'stop');

assert.deepEqual(normalizeUsage({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }), {
  status: 'reported', prompt_tokens: 2, completion_tokens: 3, total_tokens: 5
});

let observed;
execute({
  route,
  input: { payload: { prompt: 'hello', temperature: 0 } },
  secret: 'test-only-secret',
  transport: async (url, options) => {
    observed = { url, options };
    return {
      status: 200,
      json: {
        id: 'nvidia-live-shape',
        model: route.model_id,
        choices: [{ message: { content: 'world' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }
    };
  }
}).then(result => {
  assert.equal(result.ok, true);
  assert.equal(observed.url, descriptor.endpoint);
  assert.equal(observed.options.headers.Authorization, 'Bearer test-only-secret');
  assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  assert.equal(result.response.content, 'world');
  console.log('nvidia adapter tests: PASS');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
