'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'agents/termux/aria-agent.js'),
  'utf8',
);

assert.match(source, /function resolveShell\(\)/);
assert.match(source, /ARIA_SHELL_BIN/);
assert.match(source, /process\.env\.PREFIX/);
assert.match(source, /\/system\/bin\/sh/);
assert.match(source, /spawn\(shell\.path,\[\.\.\.shell\.args,command\]/);
assert.ok(
  !source.includes("spawn('/data/data/com.termux/files/usr/bin/bash'"),
  'shell execution must not hard-code the Termux bash path',
);

console.log('ANDROID TERMUX SHELL RESILIENCE CONTRACT: PASS');
