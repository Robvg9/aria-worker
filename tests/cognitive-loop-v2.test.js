'use strict';

const assert = require('assert');
const { createCognitiveLoop, normalizeRecall } = require('../autonomy/cognitive-loop');

(async () => {
  const calls = [];
  const memory = {
    async search(query, options) {
      calls.push(['search', query, options]);
      return [
        { memory_id: 'm1', title: 'Prior success', memory_type: 'lesson', content: 'Use deterministic executor selection.', confidence: 0.95, hybrid_score: 0.9 },
        { memory_id: 'm2', title: 'Old fact', memory_type: 'semantic', content: 'Legacy detail' }
      ];
    }
  };

  const started = [];
  const loop = createCognitiveLoop({
    memory,
    startMission: async (input) => {
      started.push(input);
      return {
        mission: { mission_id: 'mission_cognitive_test' },
        result: { status: 'succeeded' }
      };
    }
  });

  const result = await loop.run({ goal: 'perform a governed autonomous mission' });
  assert.strictEqual(result.result.status, 'succeeded');
  assert.strictEqual(result.cognition.recall_count, 2);
  assert.strictEqual(result.cognition.postprocessed, true);
  assert.strictEqual(started[0].metadata.cognitive_context.version, 'cognitive-loop-v2');
  assert.strictEqual(started[0].metadata.cognitive_context.recalled_memories[0].memory_id, 'm1');
  assert.strictEqual(started[0].checkpoint.cognitive_context.recall_count, 2);
  assert.deepStrictEqual(calls[0][0], 'search');
  assert.strictEqual(calls[0][1], 'perform a governed autonomous mission');

  const bounded = normalizeRecall(Array.from({ length: 30 }, (_, i) => ({ memory_id: `m${i}`, content: `x${i}` })));
  assert.strictEqual(bounded.length, 12);
  await assert.rejects(loop.run({ goal: '' }), /goal must be a non-empty string/);

  console.log('cognitive-loop-v2.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
