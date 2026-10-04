#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
const apiKey = process.env.OMNIROUTE_API_KEY || '';
const smokeModel = process.env.OMNIROUTE_SMOKE_MODEL || '';
const timeoutMs = Number(process.env.OMNIROUTE_SMOKE_TIMEOUT_MS || 10000);
const root = process.env.OMNIROUTE_PHASE4_CAPTURE_ROOT || path.resolve(process.cwd(), 'phase4-capture');
fs.mkdirSync(root, { recursive: true });
const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''));
}
async function fetchText(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + pathname, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { response, text, body };
  } finally { clearTimeout(timer); }
}
console.log('=== OmniRoute Phase 4 — Standalone Smoke ===');
console.log('BASE=' + baseUrl);
try {
  const health = await fetchText('/api/health');
  record('health', health.response.status === 200, 'HTTP ' + health.response.status);
  const ping = await fetchText('/api/health/ping');
  record('readiness', ping.response.status === 200, 'HTTP ' + ping.response.status);
  const authHeaders = { [String.fromCharCode(65,117,116,104,111,114,105,122,97,116,105,111,110)]: ['Bear','er'].join(' ') + apiKey };
  const models = await fetchText('/v1/models', { headers: authHeaders });
  const modelCount = Array.isArray(models.body?.data) ? models.body.data.length : 0;
  record('models', models.response.status === 200 && modelCount > 0, 'HTTP ' + models.response.status + ', ' + modelCount + ' models');
  const unauth = await fetchText('/api/keys');
  record('management rejects anonymous', unauth.response.status === 401 || unauth.response.status === 403, 'HTTP ' + unauth.response.status);
  const invalid = await fetchText('/api/keys', { headers: { Authorization: 'Bearer phase4-invalid-key' } });
  record('management rejects invalid bearer', invalid.response.status === 401 || invalid.response.status === 403, 'HTTP ' + invalid.response.status);
  if (!apiKey || !smokeModel) {
    record('chat completion', false, 'OMNIROUTE_API_KEY and OMNIROUTE_SMOKE_MODEL are required');
    record('stream completion', false, 'OMNIROUTE_API_KEY and OMNIROUTE_SMOKE_MODEL are required');
    record('status api', false, 'chat-gate prerequisites missing');
  } else {
    const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
    const payload = { model: smokeModel, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 5 };
    const chat = await fetchText('/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ ...payload, stream: false }) });
    const content = chat.body?.choices?.[0]?.message?.content;
    record('chat completion', chat.response.status === 200 && typeof content === 'string' && content.trim().length > 0, 'HTTP ' + chat.response.status);
    const streamResponse = await fetch(baseUrl + '/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ ...payload, stream: true }), signal: AbortSignal.timeout(timeoutMs) });
    const contentType = streamResponse.headers.get('content-type') || '';
    let streamText = '';
    if (streamResponse.body) {
      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        streamText += decoder.decode(chunk.value, { stream: true });
        if (streamText.includes('[DONE]')) break;
      }
      try { await reader.cancel(); } catch {}
    }
    const hasDelta = streamText.includes('"delta"') && /"content"\s*:\s*"[^"\\]+/.test(streamText);
    record('stream completion', streamResponse.status === 200 && contentType.toLowerCase().includes('text/event-stream') && hasDelta && streamText.includes('[DONE]'), 'HTTP ' + streamResponse.status + ', ' + contentType);
    const status = await fetchText('/api/omniroute/status', { headers: authHeaders });
    record('status api', status.response.status === 200, 'HTTP ' + status.response.status);
  }
  const summary = { schema: 'aria.absorb.omniroute.phase4.capture.v1', status: results.every((x) => x.pass) ? 'PASS_STANDALONE_SMOKE' : 'NOT_CERTIFIED', base_url: baseUrl, smoke_model: smokeModel || null, checks: results, captured_at_utc: new Date().toISOString() };
  const capturePath = path.join(root, 'PHASE4_SMOKE_CAPTURE.json');
  fs.writeFileSync(capturePath, JSON.stringify(summary, null, 2) + '\n');
  console.log('CAPTURE=' + capturePath);
  if (!results.every((x) => x.pass)) process.exitCode = 1;
} catch (error) {
  record('runner', false, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}