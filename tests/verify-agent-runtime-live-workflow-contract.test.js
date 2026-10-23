'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'verify-agent-runtime-live.yml'),
  'utf8'
);

assert.match(workflow, /name: Verify ARIA Agent Runtime LIVE/);
assert.match(workflow, /--write-out '%\{http_code\}'/,
  'LIVE verification must inspect HTTP status instead of treating every HTTP error as a retry');
assert.match(workflow, /if \[\[ "\$status" == "402" \]\]; then[\s\S]*?exit 1/,
  'HTTP 402 must stop the current LIVE verification immediately');
assert.match(workflow, /\$GITHUB_STEP_SUMMARY/,
  'an external HTTP 402 must leave a human-readable workflow summary');
assert.match(workflow, /cannot determine the underlying cause|Cause: not inferred/,
  'the diagnostic must not guess the cause of an HTTP 402');
assert.match(workflow, /Non-retryable HTTP[\s\S]*?status[\s\S]*?4xx/i,
  'non-retryable client errors must be classified separately from transient failures');
assert.doesNotMatch(workflow, /curl -fsS --max-time 15 "\$URL"/,
  'curl -f would hide the HTTP status needed for fail-fast classification');

const loopStart = workflow.indexOf('for i in {1..12}; do');
const loopEnd = workflow.indexOf('test -n "$body"', loopStart);
assert.ok(loopStart >= 0 && loopEnd > loopStart, 'expected bounded live verification loop');
const loop = workflow.slice(loopStart, loopEnd);
const quotaGate = loop.indexOf('if [[ "$status" == "402" ]]');
const sleep = loop.indexOf('sleep 5');
assert.ok(quotaGate >= 0 && sleep > quotaGate,
  'HTTP status and quota gate must be evaluated before any retry sleep');
assert.match(loop.slice(quotaGate, sleep), /exit 1/,
  'the 402 branch must exit before reaching another retry');

console.log('ARIA Agent Runtime LIVE 402 fail-fast workflow contract: PASS');
