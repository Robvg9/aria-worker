'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const oauth = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-oauth-grok-v2/index.ts'), 'utf8');
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-server-grok-v2/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902_aria_mcp_oauth.sql'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'integrations/grok/connector.toml'), 'utf8');
function mustContain(text, needle, label) { assert.ok(text.includes(needle), `${label}: missing ${needle}`); }

mustContain(oauth, 'aria-mcp-oauth-grok-v2', 'clean OAuth issuer');
mustContain(oauth, 'aria-mcp-server-grok-v2', 'clean MCP resource');
mustContain(oauth, 'code_challenge_methods_supported: ["S256"]', 'PKCE metadata');
mustContain(oauth, 'registration_endpoint', 'dynamic registration');
mustContain(oauth, 'verifyOtp', 'OTP verification');
mustContain(oauth, 'pkceMatches', 'PKCE verifier');
mustContain(oauth, 'encryptSecret', 'token encryption');
assert.equal(/console\.(log|error|warn)\s*\(/.test(oauth), false);
assert.equal(/aria_mcp_oauth_codes/.test(schema), true);
assert.equal(/encrypted_access_token/.test(schema), true);
assert.equal(/revoke all on public\.aria_mcp_oauth_codes from anon, authenticated/.test(schema), true);

mustContain(mcp, 'aria-mcp-server-grok-v2', 'clean MCP resource');
mustContain(mcp, 'aria-mcp-oauth-grok-v2', 'clean OAuth authority');
mustContain(mcp, 'streamable-http', 'Grok Streamable HTTP transport');
mustContain(mcp, 'if (req.method === "GET" || req.method === "HEAD") return reply(401', 'OAuth challenge on connector root');
mustContain(mcp, 'WWW-Authenticate', 'OAuth challenge header');
mustContain(mcp, 'resource_metadata="${RESOURCE_METADATA}"', 'protected resource metadata pointer');
mustContain(mcp, 'if (method === "initialize")', 'MCP initialize discovery');
mustContain(mcp, 'if (method === "tools/list")', 'MCP tools discovery');
mustContain(mcp, 'const auth = await authUser(req);', 'tool authorization boundary');
mustContain(mcp, 'aria_context', 'context tool');
mustContain(mcp, 'aria_memory_capture', 'memory tool');
mustContain(mcp, 'aria-memory-bridge-9-4', 'canonical memory bridge');
assert.equal(/SUPABASE_SERVICE_ROLE_KEY/.test(mcp), false);
assert.equal(/console\.(log|error|warn)\s*\(/.test(mcp), false);

mustContain(connector, 'oauth = true', 'Grok connector OAuth');
mustContain(connector, 'aria-mcp-server-grok-v2', 'Grok connector target');
console.log('PASS: Mission 9.5 clean v2 Grok OAuth + MCP discovery/auth contract');
