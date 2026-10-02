'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync('pwa/src/App.tsx', 'utf8');
for (const needle of [
  'ARIA ABSORB',
  "data-testid='aria-absorb-center'",
  "data-testid='aria-absorb-inspect'",
  "data-testid='aria-absorb-verify'",
  "data-testid='aria-absorb-register'",
  "data-testid='aria-absorb-enable'",
  'https://github.com/affaan-m/ECC',
  'tool_ecc_operator',
  'No ejecuta código externo',
  "tab === 'absorb'"
]) {
  assert.ok(app.includes(needle), 'missing PWA ABSORB contract: ' + needle);
}
console.log('pwa-absorb-ui-contract: PASS');
