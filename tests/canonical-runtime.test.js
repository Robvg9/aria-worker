'use strict';

const assert = require('assert');
const { createCanonicalAriaRuntime } = require('../autonomy/canonical-runtime');
const { createCognitiveMemory, hashContent } = require('../memory/cognitive-memory');

assert.strictEqual(typeof createCanonicalAriaRuntime, 'function');
assert.strictEqual(typeof createCognitiveMemory, 'function');
assert.strictEqual(hashContent('hello'), hashContent(' hello '));
assert.notStrictEqual(hashContent('hello'), hashContent('hello world'));

assert.throws(() => createCognitiveMemory({}), /supabaseUrl required/);

const calls = [];
const memory = createCognitiveMemory({
  supabaseUrl: 'https://example.invalid',
  serviceRoleKey: 'test-key',
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify('memory-id'), { status: 200, headers: { 'content-type': 'application/json' } });
  }
});

(async () => {
  const id = await memory.remember({ memoryType: 'lesson', title: 'Test', content: 'A lesson' });
  assert.strictEqual(id, 'memory-id');
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /rpc\/aria_memory_remember$/);
  const body = JSON.parse(calls[0].options.body);
  assert.strictEqual(body.p_memory_type, 'lesson');
  assert.strictEqual(body.p_content, 'A lesson');
  assert.strictEqual(body.p_content_hash, hashContent('A lesson'));
  console.log('canonical-runtime.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
