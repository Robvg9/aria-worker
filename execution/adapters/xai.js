/**
 * ARIA Execution Engine — xAI / Grok Provider Adapter (Mission 10.8 / 10.13 boundary)
 *
 * Translates a text_generation payload to xAI Responses API and normalizes the
 * response. Supports optional Remote MCP tools passed via input.payload.tools.
 * No routing, no retry, no account switching, no memory writes.
 * The secret is used only to build the request headers and is never included
 * in the returned object. MCP authorization tokens must already be governed
 * references resolved outside this adapter; they are never logged.
 */
'use strict';

const ENDPOINT = 'https://api.x.ai/v1/responses';

const descriptor = {
  adapter_id: 'xai_responses',
  provider_id: 'xai',
  interface_type: 'http_json',
  operations: ['text_generation'],
  status: 'registered',
  endpoint: ENDPOINT
};

function upstreamModel(route) {
  if (!route || typeof route.model_id !== 'string') return null;
  // Canonical model_id form: xai/grok-4.6 → upstream grok-4.6
  if (route.model_id.startsWith('xai/')) return route.model_id.slice(4);
  return route.model_id;
}

function buildInput(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.input) && payload.input.length > 0) return payload.input;
  if (Array.isArray(payload.messages) && payload.messages.length > 0) {
    return payload.messages.map((m) => {
      if (!m || typeof m !== 'object') return null;
      const role = typeof m.role === 'string' ? m.role : 'user';
      const content = typeof m.content === 'string' ? m.content : '';
      return { role, content };
    }).filter(Boolean);
  }
  if (typeof payload.prompt === 'string' && payload.prompt.length > 0) {
    return [{ role: 'user', content: payload.prompt }];
  }
  if (typeof payload.input === 'string' && payload.input.length > 0) {
    return payload.input;
  }
  return null;
}

function sanitizeMcpTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    if (t.type !== 'mcp') continue;
    if (typeof t.server_url !== 'string' || !t.server_url.trim()) continue;
    const entry = {
      type: 'mcp',
      server_url: t.server_url.trim()
    };
    if (typeof t.server_label === 'string' && t.server_label.trim()) {
      entry.server_label = t.server_label.trim();
    }
    // authorization must already be a governed token string if present.
    // Never invent or resolve secrets here.
    if (typeof t.authorization === 'string' && t.authorization.trim()) {
      entry.authorization = t.authorization.trim();
    }
    if (t.headers && typeof t.headers === 'object' && !Array.isArray(t.headers)) {
      entry.headers = { ...t.headers };
    }
    if (Array.isArray(t.allowed_tool_names) && t.allowed_tool_names.length) {
      entry.allowed_tool_names = t.allowed_tool_names.filter((n) => typeof n === 'string');
    }
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function buildRequest(route, input) {
  const payload = input && input.payload;
  const model = upstreamModel(route);
  if (!model) return null;
  const reqInput = buildInput(payload);
  if (reqInput === null) return null;

  const body = {
    model,
    input: reqInput
  };

  if (payload && typeof payload.temperature === 'number') body.temperature = payload.temperature;
  if (payload && typeof payload.max_tokens === 'number') body.max_output_tokens = payload.max_tokens;
  if (payload && typeof payload.max_output_tokens === 'number') body.max_output_tokens = payload.max_output_tokens;

  const mcpTools = sanitizeMcpTools(payload && payload.tools);
  if (mcpTools) body.tools = mcpTools;

  return body;
}

function extractTextFromOutput(output) {
  if (!Array.isArray(output)) return null;
  const parts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c && typeof c === 'object') {
          if (typeof c.text === 'string') parts.push(c.text);
          else if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
        }
      }
    } else if (typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  const joined = parts.join('');
  return joined.length ? joined : null;
}

function normalizeResponse(json) {
  if (!json || typeof json !== 'object') return null;

  // Responses API shape
  let content = extractTextFromOutput(json.output);
  // Fallback: OpenAI-compatible chat completions shape (defensive)
  if (content === null && Array.isArray(json.choices) && json.choices[0]) {
    const msg = json.choices[0].message;
    if (msg && typeof msg.content === 'string') content = msg.content;
  }
  // Fallback: top-level output_text
  if (content === null && typeof json.output_text === 'string') content = json.output_text;

  if (typeof content !== 'string') return null;

  return {
    modality: 'text',
    content,
    provider_response_id: typeof json.id === 'string' ? json.id : null,
    finish_reason: typeof json.status === 'string' ? json.status : (json.choices && json.choices[0] && json.choices[0].finish_reason) || null,
    provider_model: typeof json.model === 'string' ? json.model : null
  };
}

function normalizeUsage(u) {
  if (!u || typeof u !== 'object') {
    return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const num = (v) => (typeof v === 'number' ? v : null);
  // Responses API uses input_tokens / output_tokens; chat uses prompt/completion
  const prompt = num(u.input_tokens) ?? num(u.prompt_tokens);
  const completion = num(u.output_tokens) ?? num(u.completion_tokens);
  const total = num(u.total_tokens) ?? (prompt != null && completion != null ? prompt + completion : null);
  return {
    status: 'reported',
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total
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
    return { ok: false, error: { code: 'adapter_error', message: 'payload requires messages[], input, or prompt' } };
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
  buildInput,
  sanitizeMcpTools,
  normalizeResponse,
  normalizeUsage,
  upstreamModel,
  ENDPOINT
};
