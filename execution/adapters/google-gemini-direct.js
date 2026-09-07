/**
 * ARIA Execution Engine — Google Gemini Direct Provider Adapter
 * Provider adapter only: no routing, fallback, retries, memory writes, or account switching.
 */
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

const descriptor = {
  adapter_id: 'google_gemini_generate_content',
  provider_id: 'google',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: ENDPOINT,
  route_type: 'direct'
};

function buildContents(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.contents) && payload.contents.length > 0) return payload.contents;
  if (typeof payload.prompt === 'string' && payload.prompt.length > 0) {
    return [{ role: 'user', parts: [{ text: payload.prompt }] }];
  }
  return null;
}

function buildRequest(route, input) {
  const payload = input && input.payload;
  const contents = buildContents(payload);
  if (!contents) return null;
  const body = { contents };
  if (payload.systemInstruction) body.systemInstruction = payload.systemInstruction;
  if (payload.generationConfig && typeof payload.generationConfig === 'object') {
    body.generationConfig = { ...payload.generationConfig };
    delete body.generationConfig.temperature;
    delete body.generationConfig.topP;
    delete body.generationConfig.topK;
  }
  return body;
}

function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
  const num = v => (typeof v === 'number' ? v : null);
  return { status: 'reported', prompt_tokens: num(u.promptTokenCount), completion_tokens: num(u.candidatesTokenCount), total_tokens: num(u.totalTokenCount) };
}

function normalizeResponse(json, route) {
  const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
  const content = Array.isArray(parts) ? parts.filter(x => x && typeof x.text === 'string').map(x => x.text).join('') : '';
  if (!content) return null;
  return {
    modality: 'text',
    content,
    provider_response_id: null,
    finish_reason: json && json.candidates && json.candidates[0] ? (json.candidates[0].finishReason || null) : null,
    provider_model: route.model_id
  };
}

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== descriptor.provider_id || route.route_type !== 'direct') {
    return { ok: false, error: { code: 'adapter_error', message: 'route provider/type mismatch' } };
  }
  if (descriptor.operations.indexOf(route.capability) === -1) return { ok: false, error: { code: 'adapter_error', message: 'capability not supported by adapter' } };
  if (typeof transport !== 'function') return { ok: false, error: { code: 'transport_error', message: 'transport missing' } };
  if (typeof secret !== 'string' || secret.length === 0) return { ok: false, error: { code: 'credential_unavailable', message: 'secret missing' } };
  const body = buildRequest(route, input);
  if (!body) return { ok: false, error: { code: 'adapter_error', message: 'payload requires contents[] or prompt' } };
  const model = route.model_id && route.model_id.endsWith('-direct') ? route.model_id.slice('google/'.length, -'-direct'.length) : route.model_id.replace(/^google\//, '');
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  let res;
  try {
    res = await transport(endpoint, { method: 'POST', headers: { 'x-goog-api-key': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    const code = e && e.name === 'TimeoutError' ? 'timeout' : 'transport_error';
    return { ok: false, error: { code, message: 'transport failure' } };
  }
  if (!res || typeof res.status !== 'number') return { ok: false, error: { code: 'invalid_response', message: 'transport returned no status' } };
  if (res.status < 200 || res.status >= 300) {
    const msg = res.json && res.json.error && typeof res.json.error.message === 'string' ? res.json.error.message : 'provider returned HTTP ' + res.status;
    return { ok: false, error: { code: 'provider_error', message: msg, provider_status: res.status } };
  }
  const response = normalizeResponse(res.json, route);
  if (!response) return { ok: false, error: { code: 'invalid_response', message: 'no text content in provider response' } };
  return { ok: true, response, usage: normalizeUsage(res.json.usageMetadata) };
}

module.exports = { descriptor, execute, buildRequest, normalizeResponse, normalizeUsage, ENDPOINT };
