'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-server-grok-v2/index.ts'), 'utf8');
const oauth = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-oauth-grok-v2/index.ts'), 'utf8');
for (const needle of [
  'const RESOURCE_PATH = new URL(RESOURCE).pathname;',
  'const RESOURCE_METADATA = `${RESOURCE}/.well-known/oauth-protected-resource`;',
  'u.pathname === `${RESOURCE_PATH}/.well-known/oauth-protected-resource`',
  'scopes_supported: SCOPES.split(" ")',
  'scope="${SCOPES}"',
  'authorization_servers: [AUTH_SERVER]',
]) assert.ok(mcp.includes(needle), `MCP discovery: missing ${needle}`);
for (const needle of [
  'oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2',
  'u.pathname.endsWith("/.well-known/oauth-authorization-server")',
  'code_challenge_methods_supported: ["S256"]',
  'token_endpoint_auth_methods_supported: ["none"]',
]) assert.ok(oauth.includes(needle), `OAuth discovery: missing ${needle}`);
console.log('PASS: Mission 9.5 Grok function-path OAuth discovery contract');
