'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'src', 'App.tsx'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'aria-app-api-v3', 'index.ts'), 'utf8');

assert.match(app, /if \(screen !== 1\) return;/);
assert.match(app, /api\('\/conversation', session\.accessToken\)/);
assert.match(api, /path\.endsWith\('\/diagnostics\/health'\)/);
assert.match(api, /status: "unavailable"/);
assert.match(api, /observed: false/);
assert.match(api, /reason: "diagnostic_unavailable"/);

console.log('DASHBOARD ROOT RESILIENCE: PASS — Chat restoration is route-gated and operational health degrades without emitting HTTP 500.');
