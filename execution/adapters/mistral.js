'use strict';

/**
 * ARIA Execution Engine — Mistral Direct Provider Adapter
 * Provider adapter only: no routing, retry, fallback, memory writes, or account switching.
 *
 * Endpoint and request shape follow Mistral's current Chat Completion API:
 * POST https://api.mistral.ai/v1/chat/completions
 */
const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

const descriptor = {
  adapter_id: 'mistral_chat_completions',
  provider_id: 'mistral',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: ENDPOINT,
  route_type: 'direct'
};

function upstreamModel(route) {
  if (!route || typeof route.model_id !== 'string') return null;
  return route.model_id.startsWith('mistral/')
    ? route.model_id.slice('mistral/'.length)
    : route.model_id;
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
  if (!model || !messages) return null;

  const body = { model, messages };
  if (typeof payload.max_tokens === 'number') body.max_tokens = payload.max_tokens;
  if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
  if (typeof payload.top_p === 'number') body.top_p = payload.top_p;
  return body;
}

function normalizeUsage(u) {
  if (!u || typeof u !== 'object') {
    return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const num = v => (typeof v === 'number' ? v : null);
  return {
    status: 'reported',
    prompt_tokens: num(u.prompt_tokens),
    completion_tokens: num(u.completion_tokens),
    total_tokens: num(u.total_tokens)
  };
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = content.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part.text === 'string') return part.text;
    return '';
  });
  const joined = parts.join('');
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

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== descriptor.provider_id || route.route_type !== 'direct') {
    return { ok: false, error: { code: 'adapter_error', message: 'route provider/type mismatch' } };
  }
  if (descriptor.operations.indexOf(route.capability) === -1) {
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

  let res;
  try {
    res = await transport(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
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
    const providerMsg =
      res.json && res.json.error && typeof res.json.error.message === 'string'
        ? res.json.error.message
        : 'provider returned HTTP ' + res.status;
    return {
      ok: false,
      error: { code: 'provider_error', message: providerMsg, provider_status: res.status }
    };
  }

  const response = normalizeResponse(res.json);
  if (!response) {
    return { ok: false, error: { code: 'invalid_response', message: 'no text content in provider response' } };
  }
  return { ok: true, response, usage: normalizeUsage(res.json && res.json.usage) };
}

module.exports = {
  descriptor,
  execute,
  buildRequest,
  buildMessages,
  normalizeResponse,
  normalizeUsage,
  upstreamModel,
  ENDPOINT
};
