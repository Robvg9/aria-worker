'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts', 'utf8');

assert.match(source, /status:\s*"failed"/);
assert.match(source, /failure_reason:[\s\S]{0,120}retry_exhausted/);
const retryExhaustedIndex = source.indexOf('retry_exhausted');
assert.ok(retryExhaustedIndex > 0, 'v22 retry exhausted path missing');
const recoveryWindow = source.slice(Math.max(0,retryExhaustedIndex - 350), retryExhaustedIndex + 4200);
assert.match(recoveryWindow, /lease_owner:\s*null/);
assert.match(recoveryWindow, /lease_until:\s*null/);
assert.match(source, /verificationWait/);
assert.match(source, /status:\s*"waiting"/);
assert.match(source, /verifyPendingMutation/);

console.log('MISSION RUNNER V22 TERMINAL LEASE RELEASE: PASS');
