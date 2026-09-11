'use strict';

const assert = require('assert');
const { createHandler, PHASE1_TOOLS, extractBearer, redact, PROTOCOL_VERSIONS } = require('../mcp-inbound/handler');

const TOKEN = 'aria_inbound_test_token_32chars_min';
const handle = createHandler({ token: TOKEN, resource: 'https://example.test/mcp-inbound' });

function req(overrides) {
  return Object.assign({
    method: 'POST',
    path: '/mcp-inbound',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: {}
  }, overrides);
}

function rpc(method, params, id) {
  return { jsonrpc: '2.0', id: id == null ? 1 : id, method, params: params || {} };
}

{
  const res = handle(req({ method: 'GET' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.transport, 'streamable-http');
}

{
  const res = handle(req({ method: 'GET', path: '/mcp-inbound/.well-known/oauth-protected-resource' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.resource, 'https://example.test/mcp-inbound');
  assert.deepStrictEqual(res.body.bearer_methods_supported, ['header']);
}

{
  const res = handle(req({ body: rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'grok', version: 'web' }, capabilities: {} }) }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.result.protocolVersion, '2025-06-18');
  assert.strictEqual(res.body.result.serverInfo.name, 'ARIA MCP Inbound Grok');
  assert.strictEqual(res.body.result.capabilities.tools.listChanged, false);
  assert.ok(res.headers['Mcp-Session-Id']);
}

{
  const res = handle(req({ body: rpc('initialize', { protocolVersion: '1999-01-01' }) }));
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.message, 'unsupported_protocol');
}

{
  const a = handle(req({ body: rpc('tools/list', {}, 2) }));
  const b = handle(req({ body: rpc('tools/list', {}, 3) }));
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(a.body.result.tools.map((t) => t.name), ['aria_status', 'aria_context']);
  assert.deepStrictEqual(a.body.result.tools, b.body.result.tools);
  assert.deepStrictEqual(a.body.result.tools, PHASE1_TOOLS);
  assert.ok(!a.body.result.tools.some((t) => t.name === 'aria_run_task'));
}

{
  const res = handle(req({ body: rpc('tools/call', { name: 'aria_status', arguments: {} }, 4) }));
  assert.strictEqual(res.status, 200);
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.direction, 'grok_to_aria');
  assert.strictEqual(payload.xaiApi, 'not_used');
  assert.deepStrictEqual(payload.tools, ['aria_status', 'aria_context']);
}

{
  const res = handle(req({ body: rpc('tools/call', { name: 'aria_context', arguments: { query: 'status of ARIA' } }, 5) }));
  assert.strictEqual(res.status, 200);
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.query, 'status of ARIA');
  assert.strictEqual(payload.context.mode, 'read_only');
}

{
  const res = handle(req({ headers: { authorization: 'Bearer wrong-token' }, body: rpc('tools/list') }));
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'unauthorized');
  assert.ok(String(res.headers['WWW-Authenticate']).includes('Bearer'));
}
{
  const res = handle(req({ headers: {}, body: rpc('initialize', { protocolVersion: '2025-03-26' }) }));
  assert.strictEqual(res.status, 401);
}

{
  const leaked = redact({
    authorization: 'Bearer super-secret',
    note: 'ok',
    nested: { xai_api_key: 'xai-live-key', access_token: 'tok' }
  });
  assert.strictEqual(leaked.authorization, '[redacted]');
  assert.strictEqual(leaked.nested.xai_api_key, '[redacted]');
  assert.strictEqual(leaked.nested.access_token, '[redacted]');
  const status = handle(req({ body: rpc('tools/call', { name: 'aria_status', arguments: {} }) }));
  const text = JSON.stringify(status);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!/xai-/.test(text));
}

{
  const results = [1, 2, 3, 4, 5].map((n) => handle(req({ body: rpc('tools/list', {}, n) })));
  results.forEach((res) => {
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.result.tools.length, 2);
  });
  const note = handle(req({ body: { jsonrpc: '2.0', method: 'notifications/initialized' } }));
  assert.strictEqual(note.status, 202);
  const unknown = handle(req({ body: rpc('tools/call', { name: 'aria_run_task', arguments: {} }) }));
  assert.strictEqual(unknown.body.error.message, 'tool_not_enabled_in_phase1');
}

assert.strictEqual(extractBearer('Bearer abc'), 'abc');
assert.ok(PROTOCOL_VERSIONS.includes('2025-03-26'));

console.log('mcp-inbound-grok: PASS');
