'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const files = [
  'credentials/resolver.js',
  'execution/credentials.js',
  'execution/lookup.js',
  'execution/adapters/openrouter.js'
];

for (const relative of files) {
  const content = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  assert.equal(/process\.env/.test(content), false, `${relative}: no process.env credential reads`);
  assert.equal(/console\.log\([^\n]*(secret|token|password|api.?key)/i.test(content), false, `${relative}: no credential logging`);
}

const resolver = fs.readFileSync(path.join(__dirname, '..', 'credentials', 'resolver.js'), 'utf8');
assert.match(resolver, /validateRef/);
assert.match(resolver, /resolver_error/);
assert.match(resolver, /createBindingCredentialResolver/);

const execution = fs.readFileSync(path.join(__dirname, '..', 'execution', 'lookup.js'), 'utf8');
assert.match(execution, /await credentials\.resolveCredential/);
assert.match(execution, /authorization_not_approved/);
assert.match(execution, /attempt: 1/);

console.log('PASS: Block B source security checks');
