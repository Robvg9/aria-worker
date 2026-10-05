'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'agents/termux/aria-agent.js'),
  'utf8',
);

assert.match(source, /async function runAndroidNotification/);
assert.match(source, /getopt:\s+Unknown option/);
assert.match(source, /termux-api/);
assert.match(source, /Notification/);
assert.match(source, /--es['"],? ['"]id['"]/);
assert.match(source, /termux-api-direct-fallback/);
assert.match(source, /delivery_path/);

console.log('ANDROID TERMUX NOTIFICATION DIRECT FALLBACK CONTRACT: PASS');
