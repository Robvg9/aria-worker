'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts', 'utf8');

const terminalFailure = source.match(/status:\s*"failed"[\s\S]{0,900}retry_exhausted[\s\S]{0,300}/);
assert.ok(terminalFailure, 'v22 terminal failure path missing');
assert.match(terminalFailure[0], /lease_owner:\s*null/);
assert.match(terminalFailure[0], /lease_until:\s*null/);

console.log('MISSION RUNNER V22 TERMINAL LEASE RELEASE: PASS');
