'use strict';

const crypto = require('crypto');

function assert(value, message) {
  if (!value) throw new TypeError(message);
}

function hashContent(content) {
  assert(typeof content === 'string' && content.trim(), 'memory content required');
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

function createCognitiveMemory({ supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
  assert(typeof supabaseUrl === 'string' && supabaseUrl, 'supabaseUrl required');
  assert(typeof serviceRoleKey === 'string' && serviceRoleKey, 'serviceRoleKey required');
  assert(typeof fetchImpl === 'function', 'fetchImpl required');

  async function rpc(name, body) {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
    if (!response.ok) {
      const error = new Error(`memory rpc ${name} failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return Object.freeze({
    hashContent,
    remember: (input = {}) => rpc('aria_memory_remember', {
      p_memory_type: input.memoryType,
      p_title: input.title,
      p_content: input.content,
      p_content_hash: input.contentHash || hashContent(input.content),
      p_source_type: input.sourceType || 'aria',
      p_source_ref: input.sourceRef || null,
      p_provenance: input.provenance || {},
      p_metadata: input.metadata || {},
      p_confidence: input.confidence == null ? 0.5 : input.confidence,
      p_importance: input.importance == null ? 0.5 : input.importance,
      p_salience: input.salience == null ? 0.5 : input.salience
    }),
    searchLexical: (query, limit = 10) => rpc('aria_memory_search_lexical', { p_query: query, p_limit: limit }),
    recordAccess: (memoryId) => rpc('aria_memory_record_access', { p_memory_id: memoryId })
  });
}

module.exports = Object.freeze({ createCognitiveMemory, hashContent });
