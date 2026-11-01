'use strict';

const REGION = 'ap-southeast-1';
const MODEL = 'qwen3.8-max';

const descriptor = Object.freeze({
  adapter_id: 'dashscope_openai_compatible',
  provider_id: 'alibaba_dashscope',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  route_type: 'direct',
  region: REGION,
  model_id: 'alibaba_dashscope/' + MODEL
});

function parseCredential(secret, now = Date.now()) {
  if (typeof secret !== 'string' || !secret) return { ok: false, reason: 'credential_missing' };
  let value;
  try { value = JSON.parse(secret); } catch (_) {
    return { ok: false, reason: 'credential_format_invalid' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'credential_format_invalid' };
  }
  if (typeof value.api_key !== 'string' || value.api_key.length < 12 ||
      typeof value.workspace_id !== 'string' ||
      !/^[a-zA-Z0-9-]{6,80}$/.test(value.workspace_id)) {
    return { ok: false, reason: 'credential_fields_invalid' };
  }
  if (value.region !== REGION) return { ok: false, reason: 'region_not_supported' };
  if (value.free_quota_only !== true) return { ok: false, reason: 'free_quota_only_not_confirmed' };
  const expiresAt = Date.parse(value.free_quota_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { ok: false, reason: 'free_quota_expired_or_unknown' };
  }
  return {
    ok: true,
    api_key: value.api_key,
    workspace_id: value.workspace_id,
    free_quota_expires_at: new Date(expiresAt).toISOString()
  };
}

function validateCredential(secret, now = Date.now()) {
  const parsed = parseCredential(secret, now);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return {
    ok: true,
    workspace_id: parsed.workspace_id,
    region: REGION,
    free_quota_expires_at: parsed.free_quota_expires_at
  };
}

function endpointFor(workspaceId) {
  if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9-]{6,80}$/.test(workspaceId)) return null;
  return 'https://' + workspaceId + '.' + REGION +
    '.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
}

function upstreamModel(route) {
  if (!route || route.provider_id !== descriptor.provider_id) return null;
  if (route.model_id !== descriptor.model_id) return null;
  return MODEL;
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
  const requested = typeof payload.max_tokens === 'number' ? payload.max_tokens : 1024;
  const body = { model, messages, max_tokens: Math.max(1, Math.min(2048, Math.floor(requested))) };
  if (typeof payload.temperature === 'number') {
    body.temperature = Math.max(0, Math.min(2, payload.temperature));
  }
  if (typeof payload.top_p === 'number') {
    body.top_p = Math.max(0, Math.min(1, payload.top_p));
  }
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
    provider_model: typeof json.model === 'string' ? json.model : MODEL
  };
}

function sanitizeProviderMessage(value) {
  return String(value || 'provider request failed')
    .replace(/Bearer\\s+[^\\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .slice(0, 240);
}

function normalizeRateLimit(headers) {
  if (!headers || typeof headers.get !== 'function') return {};
  const names = [
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-tokens',
    'retry-after'
  ];
  return Object.fromEntries(names.map(name => [name, headers.get(name)]).filter(([, value]) => value !== null));
}

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== descriptor.provider_id ||
      route.account_id !== 'acct_dashscope_primary' || route.route_type !== 'direct') {
    return { ok: false, error: { code: 'adapter_error', message: 'route provider/account/type mismatch' } };
  }
  if (route.capability !== 'text_generation') {
    return { ok: false, error: { code: 'adapter_error', message: 'capability not supported by adapter' } };
  }
  if (typeof transport !== 'function') {
    return { ok: false, error: { code: 'transport_error', message: 'transport missing' } };
  }
  const credential = parseCredential(secret);
  if (!credential.ok) {
    return { ok: false, error: { code: 'credential_unavailable', message: credential.reason } };
  }
  const body = buildRequest(route, input);
  if (!body) {
    return { ok: false, error: { code: 'adapter_error', message: 'payload requires messages[] or prompt and a verified model route' } };
  }
  const endpoint = endpointFor(credential.workspace_id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await transport(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + credential.api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    const code = error && error.name === 'AbortError' ? 'timeout' : 'transport_error';
    return { ok: false, error: { code, message: 'provider transport failure' } };
  } finally {
    clearTimeout(timer);
  }
  if (!response || typeof response.status !== 'number') {
    return { ok: false, error: { code: 'invalid_response', message: 'transport returned no status' } };
  }
  if (response.status < 200 || response.status >= 300) {
    const providerMessage = response.json?.error?.message ||
      response.json?.message || 'provider returned HTTP ' + response.status;
    return {
      ok: false,
      error: {
        code: 'provider_error',
        message: sanitizeProviderMessage(providerMessage),
        provider_status: response.status,
        provider_code: typeof response.json?.code === 'string' ? response.json.code : null,
        rate_limit: normalizeRateLimit(response.headers)
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
    usage: normalizeUsage(response.json && response.json.usage),
    metadata: {
      provider_id: descriptor.provider_id,
      adapter_id: descriptor.adapter_id,
      region: REGION,
      free_quota_guard: 'free_quota_only',
      free_quota_expires_at: credential.free_quota_expires_at,
      rate_limit: normalizeRateLimit(response.headers)
    }
  };
}

module.exports = {
  descriptor,
  execute,
  parseCredential,
  validateCredential,
  endpointFor,
  upstreamModel,
  buildMessages,
  buildRequest,
  normalizeResponse,
  normalizeUsage,
  sanitizeProviderMessage,
  REGION,
  MODEL
};
