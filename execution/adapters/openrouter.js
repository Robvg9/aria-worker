/**
 * ARIA Execution Engine — OpenRouter Provider Adapter (Mission 10.8 / 10.13 boundary)
 *
 * Translates a text_generation payload to OpenRouter chat/completions and
 * normalizes the response. No routing, no retry, no account switching,
 * no memory writes. The secret is used only to build the request headers and
 * is never included in the returned object.
 */
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const descriptor = {
  adapter_id: 'openrouter_chat_completions',
  provider_id: 'openrouter',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: ENDPOINT
};

function buildMessages(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    return payload.messages;
  }
  if (typeof payload.prompt === 'string' && payload.prompt.length > 0) {
    return [{ role: 'user', content: payload.prompt }];
  }
  return null;
}

function buildRequest(route, input) {
  const messages = buildMessages(input && input.payload);
  if (!messages) return null;
  const body = { model: route.model_id, messages };
  const p = input.payload;
  if (typeof p.max_tokens === 'number') body.max_tokens = p.max_tokens;
  if (typeof p.temperature === 'number') body.temperature = p.temperature;
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

function normalizeResponse(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : undefined;
  if (typeof content !== 'string') return null;
  return {
    modality: 'text',
    content,
    provider_response_id: typeof json.id === 'string' ? json.id : null,
    finish_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    provider_model: typeof json.model === 'string' ? json.model : null
  };
}

/**
 * execute({ route, input, secret, transport })
 * transport(url, { method, headers, body }) → Promise<{ status, json }>
 */
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
    const providerMsg = res.json && res.json.error && typeof res.json.error.message === 'string'
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
  return { ok: true, response, usage: normalizeUsage(res.json.usage) };
}

module.exports = { descriptor, execute, buildRequest, normalizeResponse, normalizeUsage, ENDPOINT };
