'use strict';

/**
 * ARIA Execution Engine — Groq Direct Provider Adapter.
 * One request only; no retry, account switching, routing, or secret persistence.
 * Groq exposes an OpenAI-compatible Chat Completions endpoint.
 */
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const descriptor = Object.freeze({
  adapter_id: 'groq_chat_completions',
  provider_id: 'groq',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: ENDPOINT,
  route_type: 'direct'
});

function upstreamModel(route) {
  if (typeof route?.upstream_model === 'string' && route.upstream_model.trim()) {
    return route.upstream_model.trim();
  }
  if (typeof route?.model_id !== 'string') return null;
  return route.model_id.startsWith('groq/') ? route.model_id.slice('groq/'.length) : route.model_id;
}

function buildMessages(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.messages) && payload.messages.length > 0) return payload.messages;
  if (typeof payload.prompt === 'string' && payload.prompt.length > 0) {
    return [{ role: 'user', content: payload.prompt }];
  }
  return null;
}

function buildRequest(route, input) {
  const payload = input && input.payload;
  const model = upstreamModel(route);
  const messages = buildMessages(payload);
  if (!payload || typeof payload !== 'object' || !model || !messages) return null;

  const body = { model, messages };
  const completionTokens = typeof payload.max_completion_tokens === 'number'
    ? payload.max_completion_tokens
    : payload.max_tokens;
  if (typeof completionTokens === 'number') body.max_completion_tokens = completionTokens;
  if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
  if (typeof payload.top_p === 'number') body.top_p = payload.top_p;
  return body;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const num = value => typeof value === 'number' ? value : null;
  return {
    status: 'reported',
    prompt_tokens: num(usage.prompt_tokens),
    completion_tokens: num(usage.completion_tokens),
    total_tokens: num(usage.total_tokens)
  };
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const joined = content.map(part => {
    if (typeof part === 'string') return part;
    return part && typeof part.text === 'string' ? part.text : '';
  }).join('');
  return joined.length ? joined : null;
}

function normalizeResponse(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  const message = choice && choice.message ? choice.message : null;
  const content = normalizeContent(message && message.content);
  if (content === null) return null;
  return {
    modality: 'text',
    content,
    provider_response_id: typeof json.id === 'string' ? json.id : null,
    finish_reason: choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    provider_model: typeof json.model === 'string' ? json.model : null
  };
}

function sanitizeProviderMessage(value) {
  return String(value || 'provider request failed')
    .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/gsk_[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .slice(0, 300);
}

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== descriptor.provider_id || route.route_type !== 'direct') {
    return { ok: false, error: { code: 'adapter_error', message: 'route provider/type mismatch' } };
  }
  if (!descriptor.operations.includes(route.capability)) {
    return { ok: false, error: { code: 'adapter_error', message: 'capability not supported by adapter' } };
  }
  if (typeof transport !== 'function') {
    return { ok: false, error: { code: 'transport_error', message: 'transport missing' } };
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, error: { code: 'credential_unavailable', message: 'secret missing' } };
  }

  const body = buildRequest(route, input);
  if (!body) {
    return { ok: false, error: { code: 'adapter_error', message: 'payload requires messages[] or prompt' } };
  }

  let response;
  try {
    response = await transport(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    const code = error && error.name === 'TimeoutError' ? 'timeout' : 'transport_error';
    return { ok: false, error: { code, message: 'transport failure' } };
  }

  if (!response || typeof response.status !== 'number') {
    return { ok: false, error: { code: 'invalid_response', message: 'transport returned no status' } };
  }
  if (response.status < 200 || response.status >= 300) {
    const providerMessage = response.json?.error?.message || 'provider returned HTTP ' + response.status;
    return {
      ok: false,
      error: {
        code: 'provider_error',
        message: sanitizeProviderMessage(providerMessage),
        provider_status: response.status
      }
    };
  }

  const normalized = normalizeResponse(response.json);
  if (!normalized) {
    return { ok: false, error: { code: 'invalid_response', message: 'no text content in provider response' } };
  }
  return {
    ok: true,
    response: normalized,
    usage: normalizeUsage(response.json && response.json.usage)
  };
}

module.exports = {
  descriptor,
  execute,
  buildRequest,
  buildMessages,
  normalizeResponse,
  normalizeUsage,
  upstreamModel,
  sanitizeProviderMessage,
  ENDPOINT
};
