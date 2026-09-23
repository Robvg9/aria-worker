'use strict';

const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const { executeAndroidAccessibilityJob, probeLocalIpcHealth } = require('../../computer-use/android-accessibility-v1');
const { executeAutonomousAndroidMission } = require('./android-autonomous-runner-v1');

const GATEWAY_URL = process.env.ARIA_DEVICE_GATEWAY_URL;
const DEVICE_TOKEN = process.env.ARIA_DEVICE_TOKEN;
const DEVICE_ID = process.env.ARIA_DEVICE_ID;
const HEARTBEAT_MS = Math.max(10_000, Number(process.env.ARIA_HEARTBEAT_MS || 30_000));
const POLL_MS = Math.max(1_000, Number(process.env.ARIA_POLL_MS || 3_000));
const MAX_OUTPUT = 256 * 1024;
const DISPLAY_OUTPUT = 4096;

function log(message) { console.log(`[ARIA] ${new Date().toISOString()} ${message}`); }
function redact(text) {
  let value = typeof text === 'string' ? text.slice(-DISPLAY_OUTPUT) : '';
  const patterns = [ /Bearer\s+[A-Za-z0-9._\-]+/g, /\bsk-[A-Za-z0-9_\-]{8,}/g, /\bor-v1-[A-Za-z0-9_\-]{8,}/g, /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi ];
  for (const pattern of patterns) value = value.replace(pattern, '[redacted]');
  return value;
}
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\\"'\\\"'") + "'";
}
function parseAndroidNotificationPayload(command) {
  let payload;
  try { payload = JSON.parse(command); } catch (_) { throw new Error('android.notification payload must be valid JSON'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('android.notification payload must be an object');
  const required = ['notification_id','title','message','severity','kind','mission_id','priority'];
  for (const key of required) {
    if (typeof payload[key] !== 'string' || payload[key].trim() === '') throw new Error(`android.notification ${key} required`);
  }
  if (!['info','success','warning','error'].includes(payload.severity)) throw new Error('android.notification severity unsupported');
  if (!['default','high','max'].includes(payload.priority)) throw new Error('android.notification priority unsupported');
  if (payload.title.length > 120) throw new Error('android.notification title too long');
  if (payload.message.length > 2000) throw new Error('android.notification message too long');
  return payload;
}
async function runAndroidNotification(payload) {
  const binary = 'termux-notification';
  const id = `aria-meditation-${payload.notification_id}`;
  const command = [
    `command -v ${binary} >/dev/null 2>&1`,
    '&&',
    binary,
    '--id', shellQuote(id),
    '--title', shellQuote(payload.title),
    '--content', shellQuote(payload.message),
    '--priority', shellQuote(payload.priority),
    '--group', shellQuote('aria-meditation')
  ].join(' ');
  const result = await run(command, process.cwd(), 30_000);
  result.metadata = { ...(result.metadata || {}), agent_version:'aria-termux-agent-v2', operation:'android.notification', notification_id:payload.notification_id, mission_id:payload.mission_id, severity:payload.severity, kind:payload.kind, action:payload.action || null };
  return result;
}
if (!GATEWAY_URL || !DEVICE_TOKEN || !DEVICE_ID) {
  console.error('ARIA agent requires ARIA_DEVICE_GATEWAY_URL, ARIA_DEVICE_TOKEN and ARIA_DEVICE_ID');
  process.exit(2);
}
function endpoint(path) { return `${GATEWAY_URL.replace(/\/$/, '')}${path}`; }
function headers() { return { 'content-type':'application/json', authorization:`Bearer ${DEVICE_TOKEN}`, 'x-aria-device-id':DEVICE_ID }; }
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || process.env.ARIA_GATEWAY_TIMEOUT_MS || 15_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { timeoutMs: _ignored, ...fetchOptions } = options;
  try {
    const response = await fetch(endpoint(path), { ...fetchOptions, signal:controller.signal, headers:{ ...headers(), ...(fetchOptions.headers||{}) } });
    const text = await response.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw:text }; }
    if (!response.ok) throw new Error(`gateway ${response.status}: ${body?.error || 'request failed'}`);
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`gateway timeout after ${timeoutMs}ms: ${path}`);
    throw error;
  } finally { clearTimeout(timer); }
}
function run(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started=Date.now();
    const child=spawn('/data/data/com.termux/files/usr/bin/bash',['-lc',command],{cwd:cwd||process.cwd(),env:process.env});
    let stdout=''; let stderr=''; let killed=false;
    const append=(current,chunk)=>(current+chunk.toString()).slice(-MAX_OUTPUT);
    const timer=setTimeout(()=>{killed=true;child.kill('SIGTERM')},Math.max(1000,timeoutMs||120000));
    child.stdout.on('data',chunk=>{stdout=append(stdout,chunk)});
    child.stderr.on('data',chunk=>{stderr=append(stderr,chunk)});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({status:killed?'timeout':code===0?'succeeded':'failed',exit_code:typeof code==='number'?code:null,stdout,stderr,duration_ms:Date.now()-started,signal})});
    child.on('error',error=>{clearTimeout(timer);resolve({status:'failed',exit_code:null,stdout,stderr:String(error.message).slice(0,4096),duration_ms:Date.now()-started})});
  });
}
async function resolveSecret(jobId, secretRef) {
  const body=await api(`/v1/jobs/${encodeURIComponent(jobId)}/resolve-secret`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,secret_ref:secretRef})});
  if(body?.ok!==true||typeof body.secret!=='string'||!body.secret.length) throw new Error(`credential unavailable: ${body?.error||'secret_resolution_failed'}`);
  return body.secret;
}
async function heartbeat() {
  let androidUiHealth = { ok: false, reason: 'probe_not_run' };
  try {
    androidUiHealth = await probeLocalIpcHealth({ timeoutMs: 1500 });
  } catch (error) {
    androidUiHealth = { ok: false, reason: String(error?.message || error).slice(0, 180) };
  }
  const capabilities = ['shell.execute','notifications.push'];
  if (androidUiHealth.ok) capabilities.push('computer.use.android');
  try {
    await api('/v1/devices/heartbeat',{
      method:'POST',
      body:JSON.stringify({device_id:DEVICE_ID,agent_type:'android-termux',capabilities,android_ui_health:{ok:Boolean(androidUiHealth.ok),reason:androidUiHealth.reason||null,protocol:androidUiHealth.payload?.protocol||null,version_name:androidUiHealth.metadata?.version_name||null,version_code:androidUiHealth.metadata?.version_code||null,build_id:androidUiHealth.metadata?.build_id||null}})
    });
    log(`ONLINE device=${DEVICE_ID} computer.use.android=${androidUiHealth.ok ? 'READY' : 'UNAVAILABLE:' + androidUiHealth.reason}`);
  } catch(error){
    console.error(`[heartbeat] ${error.message}`);
  }
}
async function claimAndExecute() {
  try {
    const body=await api('/v1/jobs/claim',{method:'POST',body:JSON.stringify({device_id:DEVICE_ID}),timeoutMs:8_000});
    if(!body?.job)return;
    const job=body.job;
    if(job.device_id!==DEVICE_ID)throw new Error('gateway returned job for another device');
    if(!['shell.execute','android.notification','computer.use.android'].includes(job.operation))throw new Error(`unsupported operation: ${job.operation}`);
    log(`JOB RECEIVED id=${job.job_id} operation=${job.operation}`);
    await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID})});
    log(`JOB START id=${job.job_id}`);
    let result;
    if (job.operation === 'android.notification') {
      result=await runAndroidNotification(parseAndroidNotificationPayload(job.command));
    } else if (job.operation === 'computer.use.android') {
      let commandPayload = {};
      try { commandPayload = JSON.parse(String(job.command || '{}')); } catch (_) { commandPayload = {}; }
      if (commandPayload.mode === 'autonomous_test') {
        const autonomous = await executeAutonomousAndroidMission({
          api,
          executeAndroidAccessibilityJob: args => executeAndroidAccessibilityJob({
            ...args,
            resolveSecret: secretRef => resolveSecret(job.job_id, secretRef)
          }),
          goal: String(commandPayload.goal || ''),
          targetPackage: typeof commandPayload.target_package === 'string' ? commandPayload.target_package : null,
          allowAnyApp: commandPayload.allow_any_app === true,
          allowedHosts: Array.isArray(commandPayload.allowed_hosts) ? commandPayload.allowed_hosts : [],
          startUrl: typeof commandPayload.start_url === 'string' ? commandPayload.start_url : null,
          startApp: commandPayload.start_app === true,
          maxSteps: commandPayload.max_steps,
          timeoutMs: Math.min(Number(job.timeout_ms || 160000), 160000)
        });
        result={status:autonomous.status==='succeeded'?'succeeded':autonomous.status==='timeout'?'timeout':'failed',exit_code:autonomous.status==='succeeded'?0:1,stdout:'',stderr:autonomous.status==='succeeded'?'':String(autonomous.reason||'android_autonomous_test_failed'),duration_ms:null,result:{status:autonomous.status,reason:autonomous.reason,steps:autonomous.steps,trace:autonomous.trace,evidence:autonomous.evidence},metadata:{android_ui_agent:true,autonomous_test:true}};
      } else {
        const bridgeResult=await executeAndroidAccessibilityJob({command:job.command,timeoutMs:job.timeout_ms||12000,resolveSecret:secretRef=>resolveSecret(job.job_id,secretRef)});
        result={status:bridgeResult.status,exit_code:bridgeResult.status==='succeeded'?0:1,stdout:'',stderr:bridgeResult.status==='succeeded'?'':String(bridgeResult.reason||'android_accessibility_failed'),duration_ms:null,result:bridgeResult.payload||null,metadata:{...(bridgeResult.metadata||{}),android_ui_agent:true}};
        if (result.result?.metadata?.secret_ref) delete result.result.metadata.secret_ref;
      }
    } else {
      result=await run(job.command,job.cwd,job.timeout_ms);
    }
    result.metadata={...(result.metadata||{}),platform:`android-termux/${os.release()}`,request_nonce:crypto.randomUUID()};
    const safeStdout=redact(result.stdout);
    const safeStderr=redact(result.stderr);
    log(`JOB RESULT id=${job.job_id} status=${result.status} exit_code=${result.exit_code} duration_ms=${result.duration_ms}`);
    if(safeStdout)log(`STDOUT ${JSON.stringify(safeStdout)}`);
    if(safeStderr)log(`STDERR ${JSON.stringify(safeStderr)}`);
    await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,result})});
    log(`JOB ACK id=${job.job_id} status=${result.status}`);
  }catch(error){console.error(`[job] ${error.message}`)}
}
let stopping=false;
let heartbeatTimer=null;
async function loop(){
  while(!stopping){
    let finished=false;
    try{
      await Promise.race([
        claimAndExecute(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('job_claim_watchdog_timeout')),12_000))
      ]);
      finished=true;
    }catch(error){
      console.error('[claim-watchdog] ' + String(error?.message || error));
    }
    if(!finished && stopping) break;
    await new Promise(r=>setTimeout(r,POLL_MS));
  }
}
function requestStop(signal){
  if(stopping)return;
  stopping=true;
  log(`STOP requested signal=${signal}`);
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
}
process.on('SIGTERM',()=>requestStop('SIGTERM'));
process.on('SIGINT',()=>requestStop('SIGINT'));
(async()=>{
  log(`START device=${DEVICE_ID} platform=android-termux node=${process.version}`);
  await heartbeat();
  heartbeatTimer=setInterval(heartbeat,HEARTBEAT_MS);
  // The heartbeat is observability only; it must never keep a poisoned/stopped
  // worker process alive after the execution loop exits.
  heartbeatTimer.unref?.();
  await loop();
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
  log('AGENT LOOP EXIT — supervisor will restart process');
  process.exit(0);
})().catch(error=>{console.error(error);if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}process.exit(1)});