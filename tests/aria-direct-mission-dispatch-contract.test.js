'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = require('node:path').join(__dirname, '..', 'supabase', 'functions', 'aria-direct-v1', 'index.ts');
const source = fs.readFileSync(path, 'utf8');

assert.match(source, /runner_tick_for_mission/);
assert.match(source, /function kickCanonicalRunner\(missionId: string, reason: string\)/);
assert.match(source, /EdgeRuntime\.waitUntil\(promise\)/);
assert.match(source, /status: "kick_requested"/);
assert.match(source, /authority: "aria_internal\.runner_tick_for_mission"/);
assert.match(source, /status: "not_required"/);
assert.match(source, /canonical_runner_is_execution_authority/);
assert.doesNotMatch(source, /status:\s*"awaiting_device"/);
assert.doesNotMatch(source, /reason:\s*"no_online_android_termux_device"/);

console.log('ARIA DIRECT MISSION DISPATCH CONTRACT: PASS — user missions request canonical runner execution without requiring Android queue availability');
