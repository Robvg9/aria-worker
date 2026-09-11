'use strict';

const PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];
const DEFAULT_PROTOCOL = '2025-03-26';
const SERVER_INFO = { name: 'ARIA MCP Inbound Grok', version: '1.0.0' };

const PHASE1_TOOLS = [
  {
    name: 'aria_status',
    description: 'Read-only ARIA inbound status for Grok Custom MCP Connector. No secrets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'aria_context',
    description: 'Read-only authorized ARIA context snapshot for Grok. No memory writes.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      additionalProperties: false
    }
  }
];

const SECRET_KEYS = [
  'authorization', 'api_key', 'apikey', 'access_token', 'refresh_token',
  'client_secret', 'service_role', 'xai_api_key', 'password', 'secret'
];

function jsonHeaders(extra) {
  return Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'Mcp-Session-Id,WWW-Authenticate,MCP-Protocol-Version'
  }, extra || {});
}

function extractBearer(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return '';
  return authorizationHeader.startsWith('Bearer ') ? authorizationHeader.slice(7).trim() : '';
}

function tokensEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    let text = value;
    for (const key of SECRET_KEYS) {
      const re = new RegExp(key + '[^\\s]{0,40}', 'ig');
      text = text.replace(re, '[redacted]');
    }
    return text;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

function rpc(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function negotiateProtocol(requested) {
  if (!requested) return DEFAULT_PROTOCOL;
  return PROTOCOL_VERSIONS.includes(requested) ? requested : null;
}

function createHandler(options) {
  const token = options && options.token ? String(options.token) : '';
  const resource = (options && options.resource) || 'https://aria.robvg9.workers.dev/mcp-inbound';

  function unauthorized() {
    return {
      status: 401,
      headers: jsonHeaders({
        'WWW-Authenticate': `Bearer realm="aria-mcp-inbound", resource="${resource}"`
      }),
      body: { error: 'unauthorized' }
    };
  }

  function authorize(req) {
    if (!token) return false;
    const presented = extractBearer(req.headers.authorization || req.headers.Authorization || '');
    return tokensEqual(presented, token);
  }

  function sessionHeaders(req, protocol) {
    const incoming = req.headers['mcp-session-id'] || req.headers['Mcp-Session-Id'];
    const sessionId = incoming || 'aria-inbound-stateless';
    return jsonHeaders({
      'Mcp-Session-Id': sessionId,
      'MCP-Protocol-Version': protocol || DEFAULT_PROTOCOL
    });
  }

  function handleInitialize(id, params, req) {
    const requested = (params && params.protocolVersion) || req.headers['mcp-protocol-version'] || DEFAULT_PROTOCOL;
    const protocol = negotiateProtocol(requested);
    if (!protocol) {
      return { status: 400, headers: sessionHeaders(req, DEFAULT_PROTOCOL), body: rpcError(id, -32022, 'unsupported_protocol') };
    }
    return {
      status: 200,
      headers: sessionHeaders(req, protocol),
      body: rpc(id, {
        protocolVersion: protocol,
        serverInfo: SERVER_INFO,
        capabilities: { tools: { listChanged: false } },
        instructions: 'ARIA inbound MCP for Grok Free Custom Connector. Direction: Grok \u2192 ARIA only.'
      })
    };
  }

  function toolStatus() {
    return {
      ok: true,
      direction: 'grok_to_aria',
      transport: 'streamable-http',
      auth: 'governed_bearer',
      tools: PHASE1_TOOLS.map((t) => t.name),
      protocolVersions: PROTOCOL_VERSIONS,
      xaiApi: 'not_used'
    };
  }

  function toolContext(args) {
    const query = args && typeof args.query === 'string' ? args.query.trim().slice(0, 500) : '';
    return {
      ok: true,
      direction: 'grok_to_aria',
      query: query || null,
      context: {
        system: 'ARIA',
        channel: 'mcp-inbound',
        mode: 'read_only',
        note: 'Phase-1 context snapshot. Memory core is not written.'
      }
    };
  }

  function handleToolCall(id, params, req) {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === 'aria_status') {
      return { status: 200, headers: sessionHeaders(req), body: rpc(id, { content: [{ type: 'text', text: JSON.stringify(toolStatus()) }], isError: false }) };
    }
    if (name === 'aria_context') {
      return { status: 200, headers: sessionHeaders(req), body: rpc(id, { content: [{ type: 'text', text: JSON.stringify(toolContext(args)) }], isError: false }) };
    }
    if (name === 'aria_run_task' || name === 'aria_memory_query') {
      return { status: 200, headers: sessionHeaders(req), body: rpcError(id, -32601, 'tool_not_enabled_in_phase1') };
    }
    return { status: 200, headers: sessionHeaders(req), body: rpcError(id, -32601, 'unknown_tool') };
  }

  return function handle(req) {
    const methodHttp = (req.method || 'GET').toUpperCase();
    if (methodHttp === 'OPTIONS') {
      return {
        status: 204,
        headers: jsonHeaders({
          'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type,accept,mcp-protocol-version,mcp-session-id'
        }),
        body: null
      };
    }

    if (methodHttp === 'GET' && req.path && req.path.includes('.well-known/oauth-protected-resource')) {
      return {
        status: 200,
        headers: jsonHeaders(),
        body: {
          resource,
          bearer_methods_supported: ['header'],
          authorization_servers: [],
          scopes_supported: ['aria.mcp.inbound']
        }
      };
    }

    if (methodHttp === 'GET' || methodHttp === 'HEAD') {
      if (!authorize(req)) return unauthorized();
      if (methodHttp === 'HEAD') return { status: 200, headers: jsonHeaders(), body: null };
      return { status: 200, headers: jsonHeaders(), body: { ok: true, transport: 'streamable-http', resource, tools: PHASE1_TOOLS.map((t) => t.name) } };
    }

    if (methodHttp !== 'POST') {
      return { status: 405, headers: jsonHeaders({ allow: 'GET,HEAD,POST,OPTIONS' }), body: { error: 'method_not_allowed' } };
    }

    if (!authorize(req)) return unauthorized();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : null;
    const method = typeof body.method === 'string' ? body.method : '';
    const headerProtocol = req.headers['mcp-protocol-version'] || req.headers['MCP-Protocol-Version'];
    if (headerProtocol && !negotiateProtocol(headerProtocol) && method === 'initialize') {
      return { status: 400, headers: sessionHeaders(req), body: rpcError(id, -32022, 'unsupported_protocol') };
    }

    if (method === 'initialize') return handleInitialize(id, body.params || {}, req);
    if (method === 'notifications/initialized') return { status: 202, headers: sessionHeaders(req), body: null };
    if (method === 'tools/list') {
      return { status: 200, headers: sessionHeaders(req), body: rpc(id, { tools: PHASE1_TOOLS }) };
    }
    if (method === 'ping') return { status: 200, headers: sessionHeaders(req), body: rpc(id, {}) };
    if (method === 'tools/call') return handleToolCall(id, body.params || {}, req);
    return { status: 200, headers: sessionHeaders(req), body: rpcError(id, -32601, 'unsupported_method') };
  };
}

module.exports = {
  PROTOCOL_VERSIONS,
  PHASE1_TOOLS,
  SERVER_INFO,
  extractBearer,
  redact,
  createHandler
};
