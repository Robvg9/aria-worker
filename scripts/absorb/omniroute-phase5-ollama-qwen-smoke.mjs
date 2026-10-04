#!/usr/bin/env node

const base = (process.env.OMNIROUTE_PHASE5_BASE_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
const key = process.env.OMNIROUTE_PHASE5_API_KEY || '';
const model = process.env.OMNIROUTE_PHASE5_MODEL || 'local/qwen3:0.6b';
const provider = process.env.OMNIROUTE_PHASE5_PROVIDER || 'local';
const timeoutMs = Number(process.env.OMNIROUTE_PHASE5_TIMEOUT_MS || 30000);

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(base + path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pass(name, ok, detail = '') {
  if (!ok) throw new Error(name + (detail ? ' ' + detail : ''));
  console.log('PASS ' + name + (detail ? ' (' + detail + ')' : ''));
}

console.log('=== OmniRoute Phase 5 - Local Provider Smoke ===');

pass('API key present', Boolean(key));
const health = await request('/api/health');
pass('OmniRoute health', health.status === 200, 'HTTP ' + health.status);

const headers = {
  authorization: 'Bearer ' + key,
  'content-type': 'application/json'
};

const response = await request('/v1/chat/completions', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: QWEN_OK' }],
    max_tokens: 12,
    stream: false
  })
});

const body = await response.json().catch(() => null);
const content = body?.choices?.[0]?.message?.content;
const routeDecision = response.headers.get('x-omniroute-route-decision') || '';
const routeProvider = response.headers.get('x-omniroute-provider') || '';

pass('OmniRoute chat', response.status === 200, 'HTTP ' + response.status);
pass('Qwen response', typeof content === 'string' && content.trim().length > 0);
pass('Local route evidence',
  routeDecision.toLowerCase().includes(provider.toLowerCase()) ||
  routeProvider.toLowerCase() === provider.toLowerCase());

console.log('ROUTE_DECISION=' + routeDecision);
console.log('ROUTE_PROVIDER=' + routeProvider);
console.log('MODEL_REQUESTED=' + model);
console.log('MODEL_RESPONSE=' + String(body?.model || ''));
console.log('QWEN_CONTENT=' + content.trim());
console.log('PHASE5_OLLAMA_QWEN=PASS');
