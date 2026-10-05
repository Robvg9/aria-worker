'use strict';

/** ARIA Execution Engine — OmniRoute Gateway Adapter (Phase 6). */
const DEFAULT_ENDPOINT = 'http://127.0.0.1:20128/v1/chat/completions';
const PROVIDER_ID = 'omniroute';
const ROUTED_BY_HEADER = 'x-omniroute-routed-by';
const ROUTE_DECISION_HEADER = 'x-omniroute-route-decision';

const descriptor = Object.freeze({
  adapter_id: 'omniroute_gateway_chat_completions',
  provider_id: PROVIDER_ID,
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: DEFAULT_ENDPOINT
});

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function buildMessages(payload) {
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.messages) && payload.messages.length > 0) return payload.messages;
  if (typeof payload.prompt === 'string' && payload.prompt.trim()) return [{ role: 'user', content: payload.prompt }];
  return null;
}

function buildRequest(route, input) {
  if (!isRecord(route) || !isRecord(input) || !isRecord(input.payload)) return null;
  const messages = buildMessages(input.payload);
  if (!messages) return null;
  const model = typeof route.upstream_model === 'string' && route.upstream_model.trim() ? route.upstream_model.trim() :
    (typeof route.model_id === 'string' && route.model_id.trim() ? route.model_id.trim() : null);
  if (!model) return null;
  const body = { model, messages, stream: input.payload.stream === true };
  if (typeof input.payload.max_tokens === 'number') body.max_tokens = input.payload.max_tokens;
  if (typeof input.payload.temperature === 'number') body.temperature = input.payload.temperature;
  if (typeof input.payload.enable_thinking === 'boolean') body.enable_thinking = input.payload.enable_thinking;
  return body;
}

function endpointOf(route) {
  const endpoint = route && (route.gateway_endpoint || route.endpoint);
  return typeof endpoint === 'string' && endpoint.trim() ? endpoint.trim() : DEFAULT_ENDPOINT;
}

function isLoopbackEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') && url.pathname.endsWith('/chat/completions');
  } catch { return false; }
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  if (!isRecord(headers)) return '';
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find(k => k.toLowerCase() === wanted);
  return key ? String(headers[key] || '').trim() : '';
}

function normalizeUsage(usage) {
  if (!isRecord(usage)) return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
  const num = value => typeof value === 'number' ? value : null;
  const out = { status: 'reported', prompt_tokens: num(usage.prompt_tokens), completion_tokens: num(usage.completion_tokens), total_tokens: num(usage.total_tokens) };
  if (out.prompt_tokens === null && out.completion_tokens === null && out.total_tokens === null) out.status = 'unknown';
  return out;
}

function normalizeResponse(json, route) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const content = message && typeof message.content === 'string' ? message.content : '';
  if (!content.trim()) return null;
  return {
    modality: 'text',
    content,
    provider_response_id: json && typeof json.id === 'string' ? json.id : null,
    finish_reason: choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    provider_model: json && typeof json.model === 'string' ? json.model : (route && (route.upstream_model || route.model_id) || null)
  };
}

function safeMetadata(response, route) {
  return {
    gateway: PROVIDER_ID,
    gateway_model: route && (route.upstream_model || route.model_id) || null,
    routed_by: headerValue(response && response.headers, ROUTED_BY_HEADER) || null,
    route_decision: headerValue(response && response.headers, ROUTE_DECISION_HEADER) || null,
    latency_ms: typeof response?.latency_ms === 'number' ? response.latency_ms : null
  };
}

async function execute({ route, input, secret, transport }) {
  if (!route || route.provider_id !== PROVIDER_ID) return { ok: false, error: { code: 'adapter_error', message: 'route provider mismatch' } };
  if (!descriptor.operations.includes(route.capability)) return { ok: false, error: { code: 'adapter_error', message: 'capability not supported by adapter' } };
  if (typeof transport !== 'function') return { ok: false, error: { code: 'transport_error', message: 'transport missing' } };
  if (typeof secret !== 'string' || !secret.length) return { ok: false, error: { code: 'credential_unavailable', message: 'credential missing' } };
  const endpoint = endpointOf(route);
  if (!isLoopbackEndpoint(endpoint)) return { ok: false, error: { code: 'adapter_error', message: 'OmniRoute endpoint must be loopback HTTP' } };
  const body = buildRequest(route, input);
  if (!body) return { ok: false, error: { code: 'adapter_error', message: 'payload requires model and messages[] or prompt' } };
  const headers = { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' };
  if (typeof route.omniroute_provider === 'string' && route.omniroute_provider.trim()) headers['x-omniroute-provider'] = route.omniroute_provider.trim();
  let response;
  try { response = await transport(endpoint, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (error) { return { ok: false, error: { code: error && error.name === 'TimeoutError' ? 'timeout' : 'transport_error', message: 'transport failure' } }; }
  if (!response || typeof response.status !== 'number') return { ok: false, error: { code: 'invalid_response', message: 'transport returned no status' } };
  if (response.status < 200 || response.status >= 300) return { ok: false, error: { code: 'provider_error', message: 'OmniRoute returned HTTP ' + response.status, provider_status: response.status } };
  const normalized = normalizeResponse(response.json, route);
  if (!normalized) return { ok: false, error: { code: 'invalid_response', message: 'OmniRoute returned no text content' } };
  return { ok: true, response: normalized, usage: normalizeUsage(response.json && response.json.usage), metadata: safeMetadata(response, route) };
}

module.exports = { DEFAULT_ENDPOINT, PROVIDER_ID, ROUTED_BY_HEADER, ROUTE_DECISION_HEADER, descriptor, buildMessages, buildRequest, endpointOf, isLoopbackEndpoint, normalizeResponse, normalizeUsage, safeMetadata, execute };