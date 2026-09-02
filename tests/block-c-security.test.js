'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const files = [
  'mcp-gateway/lookup.js',
  'mcp-gateway/dispatch.js',
  'mcp-gateway/adapter.js',
  'mcp-router/lookup.js',
  'mcp-router/plan.js'
];

for (const relative of files) {
  const content = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  assert.equal(/process\.env\s*(?:\.|\[)/.test(content), false, `${relative}: no process.env access`);
  assert.equal(/require\(['"](?:fs|net|https|http|child_process)['"]\)/.test(content), false, `${relative}: no direct I/O modules`);
  assert.equal(/fetch\s*\(/.test(content), false, `${relative}: no direct fetch`);
  assert.equal(/supabase|notion\.|writeFile|appendFile|localStorage/i.test(content), false, `${relative}: no memory/persistence writer`);
  assert.equal(/console\.(log|info|warn|error)\([^\n]*(secret|token|password|api.?key)/i.test(content), false, `${relative}: no credential logging`);
}

const dispatch = fs.readFileSync(path.join(__dirname, '..', 'mcp-gateway', 'dispatch.js'), 'utf8');
assert.match(dispatch, /planDispatch\(/);
assert.match(dispatch, /await adapter\.execute/);
assert.match(dispatch, /sensitive_output_rejected/);
assert.match(dispatch, /Object\.freeze/);

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mcp-gateway', 'registry.json'), 'utf8'));
assert.equal(registry.live_dispatch, false);
assert.equal(registry.controlled_dispatch, true);

console.log('PASS: Block C static security boundary checks');
