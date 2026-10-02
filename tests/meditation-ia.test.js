'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createFileStateStore,createMeditationController,fingerprintMission}=require('../autonomy/meditation-ia-controller');const {createMeditationPolicy,autonomousActionAllowed}=require('../autonomy/meditation-ia-policy');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const gatewaySource=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-device-gateway','index.ts'),'utf8');
const supervisorSource=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-autonomy-supervisor-v10','index.ts'),'utf8');
const supervisorV5Source=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-autonomy-supervisor-v5','index.ts'),'utf8');
const queueMigrationSource=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20261001080000_canonical_meditation_queue_state_machine_v1.sql'),'utf8');
const priorityMigrationSource=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20261001090000_meditation_queue_priority_and_supervisor_decoupling_v1.sql'),'utf8');
assert(supervisorV5Source.includes('waitUntil'),'Autonomy supervisor v5 must not couple response latency to long-running subsystems');
assert(supervisorV5Source.includes('Promise.allSettled'),'Autonomy supervisor v5 must dispatch independent subsystems concurrently');
assert(supervisorV5Source.includes('/v1/meditation/tick-service'),'Autonomy supervisor v5 must dispatch Meditation independently');
assert(queueMigrationSource.includes('timeout_milliseconds := 60000'),'Canonical scheduler must use an explicit long request timeout');
assert(priorityMigrationSource.includes("when 'primary' then 0"),'Meditation queue must prioritize primary objectives');
assert(priorityMigrationSource.includes("when 'idea' then 90"),'Meditation queue must keep idea backlog below primary objectives');
assert(gatewaySource.includes("p==='/v1/meditation/tick-service'"),'cloud Meditation tick service route missing');
assert(gatewaySource.includes("last_cloud_tick_at"),'cloud Meditation tick must persist tick evidence');
assert(supervisorSource.includes('/v1/meditation/tick-service'),'Meditation supervisor must invoke canonical cloud tick');
assert(gatewaySource.includes("eq('metadata->>device_id',deviceId)"),'Meditation mission selection must be device-scoped');
assert(!gatewaySource.includes("metadata->>meditation_session_id')"),'Meditation mission selection must not be session-scoped');
assert(gatewaySource.includes("let deviceId=String(b.device_id||'')"),'Meditation service must not trust stale control device identity');
assert(supervisorSource.includes('device_id:null'),'Meditation supervisor must not forward stale device identity');
const windowsControllerSource=fs.readFileSync(path.join(__dirname,'..','agents','windows','aria-meditation-controller.js'),'utf8');
const runnerSource=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-mission-runner-v22','index.ts'),'utf8');
assert(windowsControllerSource.includes('ARIA_MEDITATION_AUTO_RESUME'),'Windows controller must support persisted auto-resume');
assert(windowsControllerSource.includes('AUTO_RESUME'),'Windows controller must log auto-resume evidence');
assert(windowsControllerSource.includes('OFFLINE_CONTINUITY'),'Windows controller must persist offline continuity evidence');
assert(windowsControllerSource.includes('offline-journal.jsonl'),'Windows controller must have a durable offline journal');
assert(runnerSource.includes('const MAX_STEP_ATTEMPTS = 3'),'Canonical mission runner default must allow three attempts per route');
assert(runnerSource.includes('strategyFingerprint'),'Canonical mission runner must fingerprint recovery strategies');
assert(runnerSource.includes('same_strategy_repeated_three_times'),'Canonical mission runner must force a strategy change after three identical failures');
assert(runnerSource.includes('same_strategy_repeated_five_times'),'Canonical mission runner must hard-block after five identical failures');
assert(runnerSource.includes('strategy_change_required'),'Canonical mission runner must expose strategy-change evidence');
assert(runnerSource.includes('status: "waiting_for_alternative_strategy"'),'Canonical mission runner must not terminally fail when a distinct recovery route is temporarily unavailable');

(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'aria-meditation-'));const events=[];let commands=[];let ticks=0;let checkpoints=0;const store=createFileStateStore({root_dir:root});const controller=createMeditationController({stateStore:store,commandSource:{async read(offset){const entries=commands.map(c=>({command:c,next_offset:offset+c.length+1}));commands=[];return{entries,next_offset:entries.at(-1)?.next_offset??offset}}},log:async m=>events.push(m),requestTick:async({tick})=>{ticks++;return{ok:true,status:'idle',tick}},checkpoint:async r=>{checkpoints++;return{status:'saved',...r}},isUserIdle:async()=>true,ensureNotepad:async()=>events.push('NOTEPAD'),now:()=>new Date(100000),heartbeat_ms:30000,min_idle_seconds:45,max_consecutive_failures:3});
assert.equal(fingerprintMission(' Abre   PowerShell '),'abre powershell');const policy=createMeditationPolicy();assert.equal(autonomousActionAllowed({risk:'low'},policy).allowed,true);assert.equal(autonomousActionAllowed({risk:'critical'},policy).allowed,false);assert.equal(autonomousActionAllowed({production_merge:true,risk:'low'},policy).allowed,false);
assert.equal((await controller.start()).status,'started');assert.equal(controller.status().mode,'active');for(let i=0;i<2000&&ticks===0;i++)await delay(2);assert.equal(ticks,1);for(let i=0;i<100&&controller.status().tick_count<1;i++)await delay(2);await delay(10);
commands=['PAUSA'];for(let i=0;i<50&&controller.status().mode!=='paused';i++){await controller.tick('command');if(controller.status().mode!=='paused')await delay(5)}assert.equal(controller.status().mode,'paused');commands=['AVANZA'];for(let i=0;i<50&&controller.status().mode!=='active';i++){await controller.tick('command');if(controller.status().mode!=='active')await delay(5)}assert.equal(controller.status().mode,'active');commands=['ESTADO'];await controller.tick('command');assert.ok(events.some(x=>x.includes('STATUS')));commands=['CERRAR'];await controller.tick('command');assert.equal(controller.status().mode,'stopped');assert.ok(checkpoints>=1);await controller.shutdown();
const backoffRoot=fs.mkdtempSync(path.join(os.tmpdir(),'aria-meditation-backoff-'));let nowMs=1000000;let failedCalls=0;const backoffStore=createFileStateStore({root_dir:backoffRoot});const backoff=createMeditationController({stateStore:backoffStore,commandSource:{async read(offset){return{entries:[],next_offset:offset}}},log:async()=>{},requestTick:async()=>{failedCalls++;return{status:'failed',ok:false,error:'planner_failure'}},checkpoint:async r=>r,isUserIdle:async()=>true,ensureNotepad:async()=>{},now:()=>new Date(nowMs),heartbeat_ms:60000,min_idle_seconds:0,max_consecutive_failures:1,degraded_backoff_ms:120000});assert.equal((await backoff.start()).status,'started');for(let i=0;i<100&&failedCalls<1;i++){await delay(5)}assert.equal(failedCalls,1);assert.equal(backoff.status().next_retry_at,new Date(nowMs+120000).toISOString());await backoff.tick('manual');assert.equal(failedCalls,1);nowMs+=120001;for(let i=0;i<100&&failedCalls<2;i++){await backoff.tick('manual');if(failedCalls<2)await delay(5)}assert.equal(failedCalls,2);await backoff.shutdown();
const offlineRoot=fs.mkdtempSync(path.join(os.tmpdir(),'aria-meditation-offline-'));let offlineCalls=0;let localCalls=0;let offlineNow=2000000;const offlineStore=createFileStateStore({root_dir:offlineRoot});const offline=createMeditationController({
  stateStore:offlineStore,
  commandSource:{async read(offset){return{entries:[],next_offset:offset}}},
  log:async()=>{},
  requestTick:async()=>{offlineCalls++;if(offlineCalls===1)throw new Error('This operation was aborted');return{ok:true,status:'idle'}},
  requestLocalTick:async({tick})=>{localCalls++;return{status:'offline_continuing',local_only:true,tick}},
  checkpoint:async r=>r,
  isUserIdle:async()=>true,
  ensureNotepad:async()=>{},
  now:()=>new Date(offlineNow),
  heartbeat_ms:60000,
  min_idle_seconds:0,
  max_consecutive_failures:3
});
assert.equal((await offline.start()).status,'started');
for(let i=0;i<100&&offline.status().pending_sync_count<1;i++) await delay(5);
assert.equal(localCalls,1);
assert.equal(offline.status().mode,'active');
assert.equal(offline.status().connection_status,'offline');
assert.equal(offline.status().next_retry_at,null);
assert.equal(offline.status().pending_sync_count,1);
offlineNow+=60000;
for(let i=0;i<100&&offlineCalls<2;i++){await offline.tick('offline-heartbeat');if(offlineCalls<2)await delay(5);}
assert.equal(offlineCalls,2);
assert.equal(offline.status().connection_status,'online');
assert.equal(offline.status().offline_since,null);
assert.equal(offline.status().pending_sync_count,0);
await offline.shutdown();
console.log('MEDITATION_IA_CORE_TEST=PASS');console.log(JSON.stringify({version:controller.version,ticks,checkpoints,events:events.length,backoff_test:'PASS'}));})().catch(e=>{console.error(e);process.exit(1)});
