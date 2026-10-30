'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(file, 'utf8');

test('Cloudflare Worker cannot invoke the canonical runtime from cron or manual scheduler while frozen', () => {
  const worker = read('worker.js');
  const wrangler = read('wrangler.toml');
  assert.match(wrangler, /\[triggers\][\s\S]*?crons\s*=\s*\[\s*\]/);
  assert.doesNotMatch(wrangler, /crons\s*=\s*\[\s*['"]\*\s+\*\s+\*\s+\*\s+\*['"]\s*\]/);
  assert.match(worker, /const MISSION_EXECUTION_PAUSED = true;/);
  const manual = worker.slice(worker.indexOf('async function schedulerTick'), worker.indexOf('async function runScheduledMission'));
  assert.match(manual, /MISSION_EXECUTION_PAUSED[\s\S]*?423/);
  assert.ok(manual.indexOf('MISSION_EXECUTION_PAUSED') < manual.indexOf('fetch(CANONICAL_RUNTIME,'));
  const scheduled = worker.slice(worker.indexOf('async function runScheduledMission'), worker.indexOf('// 2026-10-07 scheduler transport fallback'));
  assert.match(scheduled, /MISSION_EXECUTION_PAUSED/);
  assert.ok(scheduled.indexOf('MISSION_EXECUTION_PAUSED') < scheduled.indexOf('fetch(CANONICAL_RUNTIME,'));
});

test('canonical runtime is fail-closed before reading or forwarding a mission request', () => {
  const source = read('supabase/functions/aria-canonical-runtime-v1/index.ts');
  const handler = source.indexOf('Deno.serve(async r=>{');
  const gate = source.indexOf('if(MISSION_EXECUTION_PAUSED)', handler);
  const bodyRead = source.indexOf('const body=await r.text()', handler);
  assert.match(source, /function internalFunctionFetch\(input:RequestInfo\|URL,init:RequestInit=\{\}\)/);
  assert.ok(handler >= 0 && gate > handler && bodyRead > gate, 'pause gate must run before request forwarding');
});

test('mission runner is fail-closed before stale recovery, hard-block reopening, and claims', () => {
  const source = read('supabase/functions/aria-mission-runner-v22/index.ts');
  const handler = source.indexOf('Deno.serve(async (request) => {');
  const gate = source.indexOf('if (MISSION_EXECUTION_PAUSED)', handler);
  const bodyRead = source.indexOf('const body = await request.json()', handler);
  const recover = source.indexOf('aria_autonomy_recover_stale_missions', handler);
  const reopen = source.indexOf('aria_reopen_recoverable_hard_blocks', handler);
  const claim = source.indexOf('aria_mission_claim_next_lease', handler);
  assert.ok(handler >= 0 && gate > handler, 'runner gate must be inside the authenticated entrypoint');
  for (const [name, index] of Object.entries({ bodyRead, recover, reopen, claim })) {
    assert.ok(index > gate, 'runner gate must precede ' + name);
  }
});

test('supervisor does not fan out while paused or call the undeployed repair endpoint', () => {
  const source = read('supabase/functions/aria-autonomy-supervisor-v5/index.ts');
  const gate = source.indexOf('MISSION_EXECUTION_PAUSED)return');
  const kick = source.indexOf('const runtime=await kick(r)');
  assert.ok(gate >= 0 && kick > gate, 'supervisor gate must precede fan-out');
  assert.doesNotMatch(source, /\/functions\/v1\/aria-repair-supervisor-v1/);
  assert.match(source, /aria_repair_supervisor_v1_not_deployed/);
});

test('device gateway blocks mission, autonomy, manual queue execution, and job claim routes before parsing body', () => {
  const source = read('supabase/functions/aria-device-gateway/index.ts');
  const handler = source.indexOf('Deno.serve(async(req)=>{');
  const gate = source.indexOf('PAUSED_MISSION_ENDPOINTS.has(p)', handler);
  const bodyRead = source.indexOf('const b=await body(req)', handler);
  assert.ok(handler >= 0 && gate > handler && bodyRead > gate, 'gateway route guard must precede request body handling');
  assert.doesNotMatch(source, /req\.method==='POST'&&MISSION_EXECUTION_PAUSED/, 'the gateway pause must also cover GET-based execution probes');
  assert.ok(source.includes('PAUSED_MISSION_JOB_ROUTES.test(p)'), 'dynamic job start/secret routes must be blocked');
  assert.ok(source.includes('(?:start|resolve-secret)'), 'both dynamic job routes must be covered');
  for (const endpoint of [
    '/v1/autonomy/cycle',
    '/v1/audit/all-for-one/start',
    '/v1/audit/all-for-one/tick',
    '/v1/meditation/tick-service',
    '/v1/meditation/tick',
    '/v1/meditation/idea-to-mission',
    '/v1/meditation/queue/add',
    '/v1/meditation/queue/run-next',
    '/v1/meditation/human-gate/complete',
    '/v1/android/autonomous/decide',
    '/v1/router/execute',
    '/v1/router/parallel-execute',
    '/v1/rwht-final-probe',
    '/v1/rwht-final-repair',
    '/v1/rwht-model-probe',
    '/v1/mission5/agent-probe',
    '/v1/mission5/model-probe',
    '/v1/jobs/claim',
  ]) assert.ok(source.includes('"' + endpoint + '"'), 'blocked route missing: ' + endpoint);
});

test('autonomy selectors enforce max_attempts for core and gateway-local engines', async () => {
  const core = await import('../autonomy/dynamic-goal-engine.mjs');
  const gateway = await import('../supabase/functions/aria-device-gateway/_shared/dynamic-goal-engine.mjs');
  const goals = [
    { goal_id: 'runaway', goal: 'runaway goal', status: 'queued', attempts: 94, max_attempts: 3, priority: 100 },
    { goal_id: 'eligible', goal: 'eligible goal', status: 'queued', attempts: 2, max_attempts: 3, priority: 50 },
    { goal_id: 'paused-exhausted', goal: 'paused exhausted goal', status: 'paused', attempts: 3, max_attempts: 3, priority: 99 },
  ];
  const coreCandidates = core.generateCandidates({ goals }, { now: '2026-10-30T20:00:00.000Z' });
  assert.equal(core.selectDynamicGoal(coreCandidates)?.goal_id, 'eligible');
  const localCandidates = gateway.generateCandidates({ goals }, { now: '2026-10-30T20:00:00.000Z' });
  assert.equal(gateway.selectDynamicGoal(localCandidates, new Set(), new Set())?.goal_id, 'eligible');
  assert.equal(core.selectDynamicGoal(coreCandidates.filter((candidate) => candidate.goal_id === 'runaway')), null);
  assert.equal(gateway.selectDynamicGoal(localCandidates.filter((candidate) => candidate.goal_id === 'runaway'), new Set(), new Set()), null);
});

test('the live operational diagnostics path consumes and persists the consistency checker', () => {
  const operational = read('supabase/functions/_shared/operational-diagnostics.mjs');
  const api = read('supabase/functions/aria-app-api-v3/index.ts');
  assert.match(operational, /import \{ analyzeMissionConsistency \} from "\.\/mission-consistency\.mjs"/);
  assert.match(operational, /consistency=analyzeMissionConsistency\(\{mission,steps,jobs,events,jobEvents\}\)/);
  assert.match(api, /\.from\('execution_jobs'\)[\s\S]{0,260}\.eq\('mission_id',missionId\)/);
  assert.match(api, /const consistency=diagnostic\.consistency/);
  assert.match(api, /diagnosis:persistedDiagnosis/);
  assert.match(api, /evidence_chain:diagnostic\.evidence_chain/);
  assert.match(api, /mission_consistency:consistency/);
});

test('consistency checker flags terminal missions with open steps and missing cancel events without mutating data', async () => {
  const { analyzeMissionConsistency } = await import('../supabase/functions/_shared/mission-consistency.mjs');
  for (const status of ['failed', 'blocked', 'cancelled']) {
    const report = analyzeMissionConsistency({
      mission: { mission_id: 'mission-' + status, status, total_steps: 1, completed_steps: 0 },
      steps: [{ step_index: 1, status: 'pending' }],
      jobs: [],
      events: [],
    });
    assert.ok(report.checks.some((check) => check.code === 'terminal_mission_has_open_steps'), status + ' must flag open steps');
    if (status === 'cancelled') assert.ok(report.checks.some((check) => check.code === 'cancelled_mission_missing_event'));
  }
  const withEvent = analyzeMissionConsistency({
    mission: { mission_id: 'mission-cancelled', status: 'cancelled' },
    steps: [],
    events: [{ mission_id: 'mission-cancelled', event_type: 'mission_cancelled' }],
  });
  assert.ok(!withEvent.checks.some((check) => check.code === 'cancelled_mission_missing_event'));
  assert.equal(withEvent.version, 'aria-mission-consistency-v1.2.0');
});

test('Cloudflare Worker blocks authenticated mission and runtime proxy routes during the global freeze', () => {
  const worker = read('worker.js');
  for (const name of ['proxyRuntime', 'startMission', 'directAria']) {
    const start = worker.indexOf('async function ' + name);
    const gate = worker.indexOf('if(MISSION_EXECUTION_PAUSED)', start);
    const body = worker.indexOf('const body=await request.text()', start);
    assert.ok(start >= 0 && gate > start && body > gate, name + ' must fail closed before reading or forwarding a POST body');
  }
});

test('mission intake and direct interface reject mission creation while preserving read-only direct health', () => {
  const intake = read('supabase/functions/aria-mission-intake-v1/index.ts');
  const direct = read('supabase/functions/aria-direct-v1/index.ts');
  const intakeGate = intake.indexOf('if (MISSION_EXECUTION_PAUSED)');
  assert.ok(intakeGate > intake.indexOf('if (!token || !constantTimeEqual(token, SHARED_SECRET))'));
  assert.ok(intakeGate < intake.indexOf('body = await req.json()'));
  assert.match(direct, /if \(request\.method === "GET"\)/);
  const directGate = direct.indexOf('if (MISSION_EXECUTION_PAUSED)');
  assert.ok(directGate > direct.indexOf('if (request.method !== "POST")'));
  assert.ok(directGate < direct.indexOf('request.json()'));
});

test('runtime gateway pauses every mutating goal or job action but retains get_job reads', () => {
  const source = read('supabase/functions/aria-runtime-gateway-v1/index.ts');
  const action = source.indexOf('const action=body.action;');
  const gate = source.indexOf('MISSION_EXECUTION_PAUSED', action);
  const mutate = source.indexOf('enqueue_execution_job_gateway', action);
  const readJob = source.indexOf('get_execution_job_gateway', action);
  assert.ok(action >= 0 && gate > action && mutate > gate, 'gateway pause must precede job enqueue');
  assert.match(source, /\["vision_sync","self_improve","enqueue_device_job"\]/);
  assert.ok(readJob > gate, 'read-only job lookup must remain available');
});

test('app API fail-closes chat, mission mutations, and meditation execution controls while frozen', () => {
  const source = read('supabase/functions/aria-app-api-v3/index.ts');
  const gate = source.indexOf('const pausedMissionMutation');
  const guard = source.indexOf('if (MISSION_EXECUTION_PAUSED && pausedMissionMutation)', gate);
  const conversation = source.indexOf('path.endsWith("/conversation")', gate);
  const missionCreate = source.indexOf('path.endsWith("/missions")', gate);
  const retry = source.indexOf('verify-retry|invalidate-unverified-success|retry|human-gate', gate);
  const handler = source.indexOf('if (req.method === "POST" && path.endsWith("/conversation"))', gate);
  assert.ok(gate > 0 && guard > gate && conversation > gate && missionCreate > gate && retry > gate);
  assert.ok(handler > guard, 'route guard must run before any conversation or mission handler');
  assert.match(source, /path\.endsWith\("\/meditation\/idea-to-mission"\)/);
  assert.match(source, /path\.endsWith\("\/meditation\/control"\)/);
});

console.log('ARIA no-mission-reactivation contract tests registered');
