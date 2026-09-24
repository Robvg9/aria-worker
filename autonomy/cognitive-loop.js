'use strict';

function assertFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function normalizeRecall(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(Boolean).slice(0, 12).map((item) => ({
    memory_id: item.memory_id || item.id || null,
    title: item.title || null,
    memory_type: item.memory_type || item.memoryType || null,
    content: typeof item.content === 'string' ? item.content.slice(0, 4000) : null,
    confidence: typeof item.confidence === 'number' ? item.confidence : null,
    importance: typeof item.importance === 'number' ? item.importance : null,
    salience: typeof item.salience === 'number' ? item.salience : null,
    hybrid_score: typeof item.hybrid_score === 'number' ? item.hybrid_score : null
  }));
}

function createCognitiveLoop({
  startMission,
  memory,
  reflect = null,
  learn = null,
  worldModel = null,
  skillCompiler = null,
  confidence = null
} = {}) {
  assertFn(startMission, 'startMission');
  if (!memory || typeof memory.search !== 'function') throw new TypeError('memory.search function required');

  async function run({ goal, mission_id = null, metadata = {}, checkpoint = {} } = {}) {
    if (typeof goal !== 'string' || !goal.trim()) throw new TypeError('goal must be a non-empty string');

    const recalled = normalizeRecall(await memory.search(goal.trim(), { limit: 8 }));
    const cognitiveContext = {
      version: 'cognitive-loop-v2',
      recalled_memories: recalled,
      recall_count: recalled.length
    };

    const enrichedMetadata = {
      ...metadata,
      cognitive_context: cognitiveContext
    };

    const result = await startMission({
      goal: goal.trim(),
      mission_id,
      metadata: enrichedMetadata,
      checkpoint: {
        ...checkpoint,
        cognitive_context: cognitiveContext
      }
    });

    const outcome = result?.result || result;
    const terminal = ['succeeded', 'failed', 'cancelled', 'blocked'].includes(outcome?.status);
    let cognition = { recalled, recall_count: recalled.length, postprocessed: false };

    if (terminal) {
      const episode = {
        mission_id: result?.mission?.mission_id || result?.mission_id || mission_id || null,
        goal: goal.trim(),
        status: outcome?.status || 'unknown',
        result: outcome
      };
      const reflection = typeof reflect === 'function' ? await reflect(episode) : null;
      const [learning, world_model, confidenceResult] = await Promise.all([
        typeof learn === 'function' ? learn(episode, reflection) : Promise.resolve(undefined),
        typeof worldModel === 'function' ? worldModel(episode) : Promise.resolve(undefined),
        typeof confidence === 'function' ? confidence(episode, { reflection }) : Promise.resolve(undefined)
      ]);
      const post = { reflection, learning, world_model, confidence: confidenceResult };
      post.skill = typeof skillCompiler === 'function' ? await skillCompiler(episode, post) : undefined;
      cognition = { ...cognition, postprocessed: true, post };
    }

    return Object.freeze({ ...result, cognition });
  }

  return Object.freeze({ version: 'cognitive-loop-v2', run });
}

module.exports = Object.freeze({ createCognitiveLoop, normalizeRecall });
