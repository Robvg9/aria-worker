'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../agents/termux/aria-agent.js'),
  'utf8'
);

assert.match(source, /let activeJob = null/);
assert.match(source, /let jobStarted = false/);
assert.match(source, /jobStarted = true/);
assert.match(source, /if\(!activeJob\?\.job_id \|\| !jobStarted\)return/);
assert.match(source, /\/v1\/jobs\/.*\/result/);
assert.match(source, /agent_error:true/);
assert.match(source, /error_phase:'claim_and_execute'/);
assert.match(source, /const status=\/timeout\|timed out\/i\.test\(message\)\?'timeout':'failed'/);

console.log('TERMUX AGENT TERMINAL ERROR CONTRACT: PASS');
