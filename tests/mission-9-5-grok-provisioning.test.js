'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const mcp = fs.readFileSync(path.join(root, 'supabase/functions/aria-mcp-server-grok-v2/index.ts'), 'utf8');
function has(s) { assert.ok(mcp.includes(s), `missing ${s}`); }
has('provisioning');
has('methodEquals(mcpMethod, "initialize")');
has('methodEquals(mcpMethod, "tools/list")');
has('methodEquals(mcpMethod, "tools/call")');
has('auth_required');
assert.equal(/GET \|\| req\.method === "HEAD"[\s\S]*return reply\(401/.test(mcp), false);
console.log('PASS: Grok provisioning is public; MCP tool execution remains authenticated');
