'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const termux = fs.readFileSync('agents/termux/aria-agent.js','utf8');
const windows = fs.readFileSync('agents/windows/aria-agent.js','utf8');
const installer = fs.readFileSync('agents/windows/install-v2.ps1','utf8');
const migration = fs.readFileSync('supabase/migrations/20260929193000_cron_backpressure_hardening_v3.sql','utf8');
const authBackpressure = fs.readFileSync('supabase/migrations/20261002183000_auth_postgres_backpressure_v1.sql','utf8');
const gateway = fs.readFileSync('supabase/functions/aria-device-gateway/index.ts','utf8');

assert.match(termux, /HEARTBEAT_MS = Math\.max\(30_000, Number\(process\.env\.ARIA_HEARTBEAT_MS \|\| 60_000\)\)/);
assert.match(termux, /POLL_MS = Math\.max\(5_000, Number\(process\.env\.ARIA_POLL_MS \|\| 12_000\)\)/);
assert.match(termux, /Math\.pow\(2,consecutivePollFailures\)/);
assert.match(termux, /Math\.random\(\)/);

assert.match(windows, /HEARTBEAT_MS=Math\.max\(30_000,Number\(process\.env\.ARIA_HEARTBEAT_MS\|\|60_000\)\)/);
assert.match(windows, /POLL_MS=Math\.max\(5_000,Number\(process\.env\.ARIA_POLL_MS\|\|12_000\)\)/);
assert.match(windows, /GATEWAY_RETRIES=Math\.max\(0,Number\(process\.env\.ARIA_GATEWAY_RETRIES\|\|1\)\)/);
assert.doesNotMatch(windows, /response\.status===401\|\|response\.status===408/);

assert.match(installer, /heartbeat_ms = 60000/);
assert.match(installer, /poll_ms = 12000/);
assert.match(installer, /gateway_retries = 1/);

assert.match(migration, /aria-autonomy-supervisor-v5-every-5-minutes/);
assert.match(migration, /'2-59\/5 \* \* \* \*'/);
assert.match(migration, /aria-execution-jobs-watchdog-every-5-minutes/);
assert.match(migration, /'4-59\/5 \* \* \* \*'/);
assert.doesNotMatch(migration, /\*\/2 \* \* \* \*/);
assert.match(migration, /Recovery is owned by aria_internal\.execution_jobs_watchdog/);
assert.doesNotMatch(migration, /UPDATE aria_internal\.execution_jobs\s+SET status='queued'/);

assert.match(authBackpressure, /aria-autonomy-supervisor-v5-every-10-minutes/);
assert.match(authBackpressure, /'2-59\\/10 \\* \\* \\* \\*'/);
assert.match(authBackpressure, /aria-execution-jobs-watchdog-every-10-minutes/);
assert.match(authBackpressure, /'7-59\\/10 \\* \\* \\* \\*'/);
assert.match(authBackpressure, /timeout_milliseconds := 15000/);
assert.doesNotMatch(authBackpressure, /aria-autonomy-supervisor-v5-every-5-minutes/);
assert.doesNotMatch(authBackpressure, /aria-execution-jobs-watchdog-every-5-minutes/);

assert.match(gateway, /AUTH_CACHE_TTL_MS/);
assert.match(gateway, /authCache=new Map<string/);
assert.match(gateway, /AUTH_CACHE_MAX_ENTRIES=256/);
assert.match(gateway, /authCache\.get\(cacheKey\)/);
assert.match(gateway, /authCache\.set\(cacheKey/);

console.log('SUPABASE BACKPRESSURE CONTRACT: PASS');
