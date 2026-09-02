'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const oauth = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-oauth-v1/index.ts'), 'utf8');
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-server-9-5/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902_aria_mcp_oauth.sql'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'integrations/grok/connector.toml'), 'utf8');

function mustContain(text, needle, label) {
  assert.ok(text.includes(needle), `${label}: missing ${needle}`);
}

mustContain(oauth, '/.well-known/oauth-authorization-server', 'OAuth discovery');
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
assert.equal(/console\.(log|error|warn)\s*\(/.test(oauth), false);
assert.equal(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(oauth), true);
assert.equal(/aria_mcp_oauth_codes/.test(schema), true);
assert.equal(/encrypted_access_token/.test(schema), true);
assert.equal(/grant all on public\.aria_mcp_oauth_codes to service_role/.test(schema), true);
assert.equal(/revoke all on public\.aria_mcp_oauth_codes from anon, authenticated/.test(schema), true);

mustContain(mcp, '/.well-known/oauth-protected-resource', 'MCP protected resource');
mustContain(mcp, 'authorization_servers: [AUTH_SERVER]', 'MCP OAuth advertisement');
mustContain(mcp, 'resource_metadata="${RESOURCE_METADATA}"', 'MCP challenge resource metadata');
mustContain(mcp, 'auth.getUser(token)', 'MCP bearer validation');
mustContain(mcp, 'aria_context', 'context tool');
mustContain(mcp, 'aria_memory_capture', 'memory tool');
mustContain(mcp, 'aria-memory-bridge-9-4', 'canonical bridge');
assert.equal(/SUPABASE_SERVICE_ROLE_KEY/.test(mcp), false);
assert.equal(/console\.(log|error|warn)\s*\(/.test(mcp), false);

mustContain(connector, 'oauth = true', 'Grok connector OAuth');
mustContain(connector, 'aria-mcp-server-9-5', 'Grok connector target');

console.log('PASS: Mission 9.5 repository OAuth/PKCE contract checks');
