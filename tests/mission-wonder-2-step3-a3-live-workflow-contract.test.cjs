'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'mission-wonder-2-step3-a3-live.yml');
const source = fs.readFileSync(workflowPath, 'utf8');

assert.match(source, /^on:\s*\n  workflow_dispatch:/m, 'the live A3 pilot must be manual-only');
assert.doesNotMatch(source, /^  (push|pull_request):/m, 'the live pilot must never run on a push or PR');
assert.match(source, /confirm_live_presence_only_pilot:[\s\S]{0,300}default: false/m, 'live pilot needs an explicit false-by-default confirmation');
assert.match(source, /environment: production/m, 'Cloudflare production deployment must pass through the production environment gate');
assert.match(source, /RUNNER_NAME -ne 'ARIA-WINDOWS'[\s\S]{0,100}COMPUTERNAME -ne 'ROBVG'/m, 'physical pilot must fail closed on any runner other than ARIA-WINDOWS on ROBVG');
assert.match(source, /wrangler deploy --config wrangler\.aria-autonomy\.toml/m, 'only the isolated coordinator may be deployed');
assert.doesNotMatch(source, /ARIA_RUNTIME_SHARED_SECRET|supabase db|supabase migration|supabase functions deploy/i, 'A3 must not touch the legacy runtime secret or Supabase');
assert.doesNotMatch(source, /Enable-ScheduledTask|Start-ScheduledTask|Register-ScheduledTask|Set-ScheduledTask/m, 'A3 must never enable or start the persistent task');
assert.match(source, /ttl_ms = 180000/m, 'the pilot TTL must stay within the three-minute cap');
assert.match(source, /CLOSE_MISSION_WONDER_2_A3_PRESENCE_ONLY/m, 'the workflow must close/revoke its scope in finally');
assert.match(source, /MISSION_WONDER_2_A3_PRESENCE_SCOPE_TOKEN/m, 'the worker must use the one-shot A3 scope token');
assert.match(source, /Stop-Process -Id \$workerOne\.Id -Force/m, 'the recovery pilot must deliberately simulate a bounded worker-process crash');
assert.match(source, /A3_STALE_HEARTBEAT_DETECTION=PASS/m, 'the workflow must verify stale-heartbeat detection');
assert.match(source, /A3_ZERO_ORPHAN_WORKER_PROCESSES=PASS/m, 'the workflow must verify no worker process is left behind');

process.stdout.write('MISSION_WONDER_2_A3_LIVE_WORKFLOW_GUARDS=PASS\n');
