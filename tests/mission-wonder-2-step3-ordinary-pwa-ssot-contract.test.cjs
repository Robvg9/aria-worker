'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const pwa = read('pwa', 'src', 'ProjectWorkspace.tsx');
const appApi = read('supabase', 'functions', 'aria-app-api-v3', 'index.ts');
const direct = read('supabase', 'functions', 'aria-direct-v1', 'index.ts');
const intake = read('supabase', 'functions', 'aria-mission-intake-v1', 'index.ts');
const canonicalRuntime = read('supabase', 'functions', 'aria-canonical-runtime-v1', 'index.ts');
const cloudflare = read('cloudflare-autonomy', 'worker.mjs');
const previewContract = read('tests', 'cloudflare-autonomy-remote-plan-producer.test.cjs');

function position(source, fragment, message) {
  const index = source.indexOf(fragment);
  assert.notEqual(index, -1, message || `Missing source contract: ${fragment}`);
  return index;
}

// The ordinary PWA path must keep a stable request identity and use the canonical API.
assert.match(pwa, /createMissionRequestRef=useRef<\{key:string;requestId:string\}\|null>\(null\)/);
assert.match(pwa, /headers:\{'x-aria-request-id':request\.requestId\}/);
assert.match(pwa, /api\('\/missions',session\.accessToken,\{method:'POST'/);
assert.match(pwa, /api\('\/projects\/'.*\/missions\?limit=20/);
assert.match(pwa, /api\('\/missions\/'+encodeURIComponent\(missionId\)/);
const createMissionStart = position(pwa, 'async function createMission(payload:any={})');
const createMissionEnd = position(pwa, '  return <main className=', 'PWA project workspace render boundary missing');
const pwaCreate = pwa.slice(createMissionStart, createMissionEnd);
assert.ok(pwaCreate.includes("api('/missions'"), 'PWA mission create must stay on the canonical app API');
assert.ok(pwaCreate.includes("createMissionRequestRef.current=null"), 'request identity must only clear after a canonical mission ID is acknowledged');
assert.ok(pwaCreate.includes('createdMissionId'), 'PWA must require a canonical mission ID before reporting create success');

// The app API is the canonical owner-facing mission boundary and remains fail-closed.
assert.match(appApi, /const MISSION_EXECUTION_PAUSED = true;/);
const pauseGate = position(appApi, 'if (MISSION_EXECUTION_PAUSED && pausedMissionMutation)');
const createHandler = position(appApi, 'if (req.method === "POST" && path.endsWith("/missions"))');
assert.ok(pauseGate < createHandler, 'the global pause must reject before the ordinary mission create handler');
assert.ok(appApi.includes('from("mission_state")'), 'PWA mission reads and idempotency recovery must use canonical mission_state');
assert.ok(appApi.includes('const readMissionByRequestId = async () => {'), 'mission create must reconcile retries by request ID');
assert.ok(appApi.includes('.eq("metadata->>request_id", requestId)'), 'mission retry readback must bind the exact request ID');
assert.ok(appApi.includes('.eq("metadata->>user_id", user.id)'), 'mission retry readback must be owner scoped');
const idempotencyReadback = position(appApi, 'priorMission = await readMissionByRequestId();');
const directDispatch = position(appApi, 'direct = await internal(DIRECT, {');
assert.ok(idempotencyReadback < directDispatch, 'canonical readback must precede any repeat intake dispatch');

// Every legacy canonical mission boundary remains frozen before a write or forward.
assert.match(direct, /const MISSION_EXECUTION_PAUSED = true;/);
const directPause = position(direct, 'if (MISSION_EXECUTION_PAUSED) return out({ error: "mission_execution_paused", execution_enabled: false }, 423);');
const directBodyRead = position(direct, 'const body = await request.json().catch(() => null);');
assert.ok(directPause < directBodyRead, 'DIRECT must reject before parsing/forwarding an ordinary mission create');
assert.ok(direct.includes('const MISSION_INTAKE ='), 'DIRECT must retain the canonical intake route');

assert.match(intake, /const MISSION_EXECUTION_PAUSED = true;/);
const intakePause = position(intake, 'if (MISSION_EXECUTION_PAUSED) {');
const intakeBodyRead = position(intake, 'body = await req.json();');
const intakeWrite = position(intake, 'supabase.rpc("aria_mission_create"');
assert.ok(intakePause < intakeBodyRead && intakePause < intakeWrite, 'mission intake must fail closed before parsing or writing');

assert.match(canonicalRuntime, /const MISSION_EXECUTION_PAUSED=true;/);
const runtimePause = position(canonicalRuntime, 'if(MISSION_EXECUTION_PAUSED)return out({ok:false,status:"paused",error:"mission_execution_paused"');
const runtimeBodyRead = position(canonicalRuntime, 'const body=await r.text();');
const runtimeForward = position(canonicalRuntime, 'internalFunctionFetch(RUNNER');
assert.ok(runtimePause < runtimeBodyRead && runtimePause < runtimeForward, 'canonical runtime must stop before body forwarding to the runner');

// The Cloudflare Durable Object remains a distinct store; it must not be silently
// presented as the same mission identity that the PWA reads from mission_state.
assert.match(cloudflare, /Supabase-independent Cloudflare Worker coordinator/);
assert.match(cloudflare, /export const MISSION_EXECUTION_PAUSED = true;/);
assert.match(cloudflare, /this\.ctx\.storage\.put\('mission:' \+ mission\.mission_id, mission\)/);
assert.match(cloudflare, /this\.ctx\.storage\.get\('mission:' \+ missionId\)/);
assert.match(cloudflare, /url\.pathname === '\/api\/missions'/);
assert.match(previewContract, /assert\.equal\(previewBody\.durable_state_mutated, false\)/);
assert.match(previewContract, /assert\.equal\(state\.storage\.values\.size, 0/);

process.stdout.write('MISSION_WONDER_2_STEP3_PWA_CANONICAL_SSOT_GATE=PASS\n');
process.stdout.write('PWA_ORDINARY_CREATE_IDEMPOTENCY_CONTRACT=PASS\n');
process.stdout.write('SUPABASE_CANONICAL_READS_AND_FREEZE=PASS\n');
process.stdout.write('CLOUDFLARE_DURABLE_OBJECT_SEPARATION=PASS\n');
process.stdout.write('NO_LIVE_MISSION_OR_PRODUCTION_MUTATION=PASS\n');
