'use strict';

/**
 * ARIA Execution Engine — NVIDIA NIM / API Catalog adapter.
 * NVIDIA-hosted endpoint is OpenAI-compatible. This adapter only translates
 * requests and normalizes responses; routing, retry, fallback, memory and
 * secret persistence remain ARIA concerns outside this boundary.
 */

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

const descriptor = Object.freeze({
  adapter_id: 'nvidia_nim_chat_completions',
  provider_id: 'nvidia',
  interface_type: 'openai_compatible_http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: ENDPOINT,
  route_type: 'catalog'
});

function upstreamModel(route) {
  if (!route || typeof route.model_id !== 'string') return null;
  return route.upstream_model || route.model_id;
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
  const numeric = ['max_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];
  for (const key of numeric) {
    if (payload && typeof payload[key] === 'number') body[key] = payload[key];
  }
  if (payload && typeof payload.stream === 'boolean') body.stream = payload.stream;
  if (payload && typeof payload.reasoning_effort === 'string') body.reasoning_effort = payload.reasoning_effort;
  if (payload && Array.isArray(payload.tools) && payload.tools.length) body.tools = payload.tools;
  if (payload && payload.tool_choice !== undefined) body.tool_choice = payload.tool_choice;
  return body;
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
  const toolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];

  if (content === null && toolCalls.length === 0) return null;

  return {
    modality: 'text',
    content: content || '',
    tool_calls: toolCalls,
    provider_response_id: typeof json.id === 'string' ? json.id : null,
    finish_reason: choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    provider_model: typeof json.model === 'string' ? json.model : null
  };
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

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== descriptor.provider_id || route.route_type !== descriptor.route_type) {
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
    const providerMsg = res.json && res.json.error && typeof res.json.error.message === 'string'
      ? res.json.error.message
      : 'provider returned HTTP ' + res.status;
    return { ok: false, error: { code: 'provider_error', message: providerMsg, provider_status: res.status } };
  }

  const response = normalizeResponse(res.json);
  if (!response) return { ok: false, error: { code: 'invalid_response', message: 'no usable completion content' } };

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
