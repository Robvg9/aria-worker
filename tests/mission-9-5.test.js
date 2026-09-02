'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const oauth = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-oauth-v1/index.ts'), 'utf8');
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-server-grok-v1/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902_aria_mcp_oauth.sql'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'integrations/grok/connector.toml'), 'utf8');
function mustContain(text, needle, label) { assert.ok(text.includes(needle), `${label}: missing ${needle}`); }

mustContain(oauth, '/.well-known/oauth-authorization-server', 'OAuth discovery');
mustContain(oauth, 'code_challenge_methods_supported: ["S256"]', 'PKCE metadata');
mustContain(oauth, '/authorize', 'authorization endpoint');
mustContain(oauth, '/token', 'token endpoint');
mustContain(oauth, '/register', 'dynamic registration');
mustContain(oauth, 'verifyOtp', 'OTP verification');
mustContain(oauth, 'pkceMatches', 'PKCE verifier');
mustContain(oauth, 'encryptSecret', 'token encryption');
assert.equal(/console\.(log|error|warn)\s*\(/.test(oauth), false);
assert.equal(/aria_mcp_oauth_codes/.test(schema), true);
assert.equal(/encrypted_access_token/.test(schema), true);
assert.equal(/revoke all on public\.aria_mcp_oauth_codes from anon, authenticated/.test(schema), true);

mustContain(mcp, 'aria-mcp-server-grok-v1', 'clean MCP resource');
mustContain(mcp, 'aria-mcp-oauth-grok-v1', 'clean OAuth authority');
mustContain(mcp, 'streamable-http', 'Grok Streamable HTTP transport');
mustContain(mcp, 'if (method === "initialize")', 'unauthenticated initialize discovery');
mustContain(mcp, 'if (method === "tools/list")', 'unauthenticated tools discovery');
mustContain(mcp, 'const auth = await authUser(req);', 'tool authorization boundary');
mustContain(mcp, 'WWW-Authenticate', 'OAuth challenge');
mustContain(mcp, 'aria_context', 'context tool');
mustContain(mcp, 'aria_memory_capture', 'memory tool');
mustContain(mcp, 'aria-memory-bridge-9-4', 'canonical memory bridge');
mustContain(mcp, '2025-03-26', 'Grok-compatible MCP version');
assert.equal(/SUPABASE_SERVICE_ROLE_KEY/.test(mcp), false);
assert.equal(/console\.(log|error|warn)\s*\(/.test(mcp), false);

mustContain(connector, 'oauth = true', 'Grok connector OAuth');
mustContain(connector, 'aria-mcp-server-grok-v1', 'Grok connector target');
console.log('PASS: Mission 9.5 Grok connector discovery/auth contract');
