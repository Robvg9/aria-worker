/**
 * ARIA Execution Engine — Google Gemini API adapter.
 * Direct server-to-server provider boundary; no routing, retry, account switching,
 * memory writes, or secret persistence. The credential is only used to sign
 * the outbound request and is never returned in response objects.
 */
const BASE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const descriptor = Object.freeze({
  adapter_id: 'google_gemini_generate_content',
  provider_id: 'google',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: BASE_ENDPOINT + '/{model}:generateContent'
});

function buildContents(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.contents) && payload.contents.length > 0) return payload.contents;
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    return payload.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content ?? '') }]
    }));
  }
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
  if (payload && payload.system_instruction) {
    body.systemInstruction = { parts: [{ text: String(payload.system_instruction) }] };
  }
  const generationConfig = {};
  if (payload && typeof payload.max_tokens === 'number') generationConfig.maxOutputTokens = payload.max_tokens;
  if (payload && typeof payload.temperature === 'number') generationConfig.temperature = payload.temperature;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  if (payload && payload.tools) body.tools = payload.tools;
  return body;
}

function normalizeUsage(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const num = v => (typeof v === 'number' ? v : null);
  return {
    status: 'reported',
    prompt_tokens: num(metadata.promptTokenCount),
    completion_tokens: num(metadata.candidatesTokenCount),
    total_tokens: num(metadata.totalTokenCount)
  };
}

function normalizeResponse(json) {
  const candidates = json && Array.isArray(json.candidates) ? json.candidates : [];
  const candidate = candidates[0];
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
    ? candidate.content.parts : [];
  const text = parts.filter(p => p && typeof p.text === 'string').map(p => p.text).join('');
  if (!text) return null;
  return {
    modality: 'text',
    content: text,
    provider_response_id: null,
    finish_reason: candidate && typeof candidate.finishReason === 'string' ? candidate.finishReason : null,
    provider_model: null
  };
}

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== descriptor.provider_id) {
    return { ok: false, error: { code: 'adapter_error', message: 'route provider mismatch' } };
  }
  if (descriptor.operations.indexOf(route.capability) === -1) {
    return { ok: false, error: { code: 'adapter_error', message: 'capability not supported by adapter' } };
  }
  if (typeof transport !== 'function') {
    return { ok: false, error: { code: 'transport_error', message: 'transport missing' } };
  }
  if (typeof secret !== 'string' || !secret.length) {
    return { ok: false, error: { code: 'credential_unavailable', message: 'credential missing' } };
  }
  const model = route.upstream_model || route.model_id;
  if (typeof model !== 'string' || !model.length || model.includes('/')) {
    return { ok: false, error: { code: 'adapter_error', message: 'direct Gemini route requires a valid upstream model id' } };
  }
  const body = buildRequest(route, input);
  if (!body) {
    return { ok: false, error: { code: 'adapter_error', message: 'payload requires contents[], messages[] or prompt' } };
  }

  let res;
  try {
    res = await transport(`${BASE_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': secret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    const code = e && e.name === 'TimeoutError' ? 'timeout' : 'transport_error';
    return { ok: false, error: { code, message: 'transport failure' } };
  }

  if (!res || typeof res.status !== 'number') {
    return { ok: false, error: { code: 'invalid_response', message: 'transport returned no status' } };
  }
  if (res.status < 200 || res.status >= 300) {
    const providerMsg = res.json && res.json.error && typeof res.json.error.message === 'string'
      ? res.json.error.message
      : `provider returned HTTP ${res.status}`;
    return { ok: false, error: { code: 'provider_error', message: providerMsg, provider_status: res.status } };
  }

  const response = normalizeResponse(res.json);
  if (!response) {
    return { ok: false, error: { code: 'invalid_response', message: 'no text content in provider response' } };
  }
  return { ok: true, response, usage: normalizeUsage(res.json.usageMetadata) };
}

module.exports = { descriptor, execute, buildContents, buildRequest, normalizeResponse, normalizeUsage, BASE_ENDPOINT };
