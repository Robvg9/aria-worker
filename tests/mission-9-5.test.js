'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const oauth = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-oauth-v1/index.ts'), 'utf8');
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-server-9-5/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902_aria_mcp_oauth.sql'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'integrations/grok/connector.toml'), 'utf8');

function mustContain(text, needle, label) { assert.ok(text.includes(needle), `${label}: missing ${needle}`); }

mustContain(oauth, 'aria-mcp-oauth-grok-v1', 'clean OAuth issuer');
mustContain(oauth, 'aria-mcp-server-grok-v1', 'clean MCP resource');
mustContain(oauth, '/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v1', 'RFC8414 OAuth metadata path');
mustContain(oauth, 'issuer: ISSUER', 'OAuth issuer');
mustContain(oauth, 'code_challenge_methods_supported: ["S256"]', 'PKCE metadata');
mustContain(oauth, '/register', 'dynamic registration');
mustContain(oauth, '/authorize/start', 'authorization start');
mustContain(oauth, '/authorize/verify', 'authorization verification');
mustContain(oauth, '/authorize/ui', 'browser authorization UI');
mustContain(oauth, 'Response.redirect(ui.toString(), 302)', 'browser authorization redirect');
mustContain(oauth, 'content-type": "text/html; charset=utf-8', 'HTML authorization UI content type');
mustContain(oauth, '/token', 'token endpoint');
mustContain(oauth, 'verifyOtp', 'Supabase OTP verification');
mustContain(oauth, 'pkceMatches', 'PKCE verifier');
mustContain(oauth, 'encryptSecret', 'token encryption');
mustContain(oauth, 'redirect.searchParams.set("iss", ISSUER)', 'RFC9207 issuer callback');
assert.equal(/console\.(log|error|warn)\s*\(/.test(oauth), false);
assert.equal(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(oauth), true);
assert.equal(/aria_mcp_oauth_codes/.test(schema), true);
assert.equal(/encrypted_access_token/.test(schema), true);
assert.equal(/grant all on public\.aria_mcp_oauth_codes to service_role/.test(schema), true);
assert.equal(/revoke all on public\.aria_mcp_oauth_codes from anon, authenticated/.test(schema), true);

mustContain(mcp, 'aria-mcp-server-grok-v1', 'clean MCP resource');
mustContain(mcp, 'aria-mcp-oauth-grok-v1', 'clean OAuth authority');
mustContain(mcp, '/.well-known/oauth-protected-resource/functions/v1/aria-mcp-server-grok-v1', 'standard protected-resource metadata path');
mustContain(mcp, 'return (await authenticate(req)).response', 'protected root authentication discovery');
mustContain(mcp, 'GET" || req.method === "HEAD"', 'protected root discovery methods');
mustContain(mcp, 'authorization_servers: [AUTH_SERVER]', 'MCP OAuth advertisement');
mustContain(mcp, 'resource_metadata="${RESOURCE_METADATA}"', 'MCP challenge resource metadata');
mustContain(mcp, 'auth.getUser(token)', 'MCP bearer validation');
mustContain(mcp, 'aria_context', 'context tool');
mustContain(mcp, 'aria_memory_capture', 'memory tool');
mustContain(mcp, 'aria-memory-bridge-9-4', 'canonical bridge');
mustContain(mcp, '2026-07-28', 'modern MCP version');
mustContain(mcp, 'server/discover', 'modern discovery method');
mustContain(mcp, 'Mcp-Method does not match JSON-RPC method', 'standard header consistency');
mustContain(mcp, 'Mcp-Name does not match tool name', 'tool header consistency');
mustContain(mcp, 'originAllowed', 'Origin validation');
mustContain(mcp, 'io.modelcontextprotocol/serverInfo', 'modern server identity metadata');
mustContain(mcp, 'MCP-Protocol-Version', 'protocol version header');
assert.equal(/SUPABASE_SERVICE_ROLE_KEY/.test(mcp), false);
assert.equal(/console\.(log|error|warn)\s*\(/.test(mcp), false);

mustContain(connector, 'oauth = true', 'Grok connector OAuth');
mustContain(connector, 'aria-mcp-server-grok-v1', 'Grok connector target');

console.log('PASS: Mission 9.5 clean Grok OAuth + MCP protected discovery contract checks');
