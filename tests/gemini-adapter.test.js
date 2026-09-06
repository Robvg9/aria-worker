'use strict';

const assert = require('assert');
const { descriptor, buildContents, buildRequest, normalizeResponse, normalizeUsage, execute } = require('../execution/adapters/gemini');

assert.strictEqual(descriptor.provider_id, 'google');
assert.deepStrictEqual(buildContents({ prompt: 'hello' }), [{ role: 'user', parts: [{ text: 'hello' }] }]);
assert.deepStrictEqual(buildContents({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }), [
  { role: 'user', parts: [{ text: 'hi' }] },
  { role: 'model', parts: [{ text: 'yo' }] }
]);
assert.strictEqual(buildContents({}), null);

const route = { provider_id: 'google', capability: 'text_generation', model_id: 'gemini-2.5-flash-lite', upstream_model: 'gemini-2.5-flash-lite' };
const req = buildRequest(route, { payload: { prompt: 'hello', max_tokens: 42, temperature: 0.2, system_instruction: 'be concise' } });
assert.strictEqual(req.contents[0].parts[0].text, 'hello');
assert.strictEqual(req.generationConfig.maxOutputTokens, 42);
assert.strictEqual(req.generationConfig.temperature, 0.2);
assert.strictEqual(req.systemInstruction.parts[0].text, 'be concise');

const normalized = normalizeResponse({
  candidates: [{ content: { parts: [{ text: 'hel' }, { text: 'lo' }] }, finishReason: 'STOP' }]
});
assert.deepStrictEqual(normalized, {
  modality: 'text', content: 'hello', provider_response_id: null, finish_reason: 'STOP', provider_model: null
});
assert.strictEqual(normalizeResponse({ candidates: [] }), null);
assert.deepStrictEqual(normalizeUsage({ promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }), {
  status: 'reported', prompt_tokens: 1, completion_tokens: 2, total_tokens: 3
});

let observed;
execute({ route, input: { payload: { prompt: 'hello' } }, secret: 'test-only-secret', transport: async (url, options) => {
  observed = { url, options };
  return { status: 200, json: { candidates: [{ content: { parts: [{ text: 'world' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } } };
} }).then(result => {
  assert.ok(result.ok);
  assert.strictEqual(observed.url.endsWith('/gemini-2.5-flash-lite:generateContent'), true);
  assert.strictEqual(observed.options.headers['x-goog-api-key'], 'test-only-secret');
  assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  assert.strictEqual(result.response.content, 'world');
  console.log('gemini adapter tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
