'use strict';
const crypto = require('node:crypto');
const { createAtomicHeartbeatWriter } = require('./atomic-heartbeat-writer.cjs');
const { runHeartbeatLoop } = require('./heartbeat-scheduler.cjs');
const { createGatewayLookup } = require('./gateway-dns-lookup.cjs');
const { createGatewayRequest } = require('./gateway-http-client.cjs');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const os = require('node:os');
const { parseShellJob, executePowerShell } = require('./windows-shell-executor');
const { createWindowsMeditationController } = require('./aria-meditation-controller');
const { runAutonomousRwht } = require('./autonomous-rwht-controller');
const { getWindowsResourceProfile } = require('./resource-profile');
const { executeVoiceDeviceCommand, parseAllowlist, UUID_RE } = require('../shared/voice-command-executor.cjs');
const { executeWindowsDesktop } = (() => {
  try { return require('./windows-desktop-adapter'); }
  catch (error) { if (error?.code !== 'MODULE_NOT_FOUND') throw error; return require('../../computer-use/windows-desktop-adapter'); }
})();
const GATEWAY_URL=process.env.ARIA_DEVICE_GATEWAY_URL, DEVICE_TOKEN=process.env.ARIA_DEVICE_TOKEN, DEVICE_ID=process.env.ARIA_DEVICE_ID;
const gatewayLookup=createGatewayLookup({
  onFallbackStart:({hostname,systemErrorCode,servers})=>log(`GATEWAY_DNS_FALLBACK start host=${hostname} system_error=${systemErrorCode} servers=${servers.join(',')}`),
  onFallbackResult:({hostname,status,family,addressCount,errorCode})=>log(`GATEWAY_DNS_FALLBACK result host=${hostname} status=${status} family=${family} address_count=${addressCount||0} error=${errorCode||'none'}`)
});
// Keep the A6 device heartbeat capped at 30 seconds even when a legacy config.json still says 60000.
const HEARTBEAT_MS=30_000, POLL_MS=Math.max(5_000,Number(process.env.ARIA_POLL_MS||12_000));
const GATEWAY_TIMEOUT_MS=Math.max(3_000,Number(process.env.ARIA_GATEWAY_TIMEOUT_MS||15_000)), GATEWAY_RETRIES=Math.max(0,Number(process.env.ARIA_GATEWAY_RETRIES||1));
const OLLAMA_URL=process.env.ARIA_OLLAMA_URL||'http://127.0.0.1:11434', OLLAMA_MODEL=process.env.ARIA_OLLAMA_MODEL||'qwen3:0.6b', OLLAMA_OPERATION='ollama.qwen3', SHELL_OPERATION='shell.execute', COMPUTER_OPERATION='computer.use', AUTONOMOUS_COMPUTER_OPERATION='computer.use.autonomous';
const RESOURCE_PROFILE=getWindowsResourceProfile();
const OLLAMA_REQUESTED=process.env.ARIA_OLLAMA_ENABLED==='true';
const OLLAMA_ENABLED=OLLAMA_REQUESTED&&RESOURCE_PROFILE.local_llm_eligible;
const MAX_OUTPUT=256*1024, DISPLAY_OUTPUT=4096;

const VOICE_ALLOWED_APPS = parseAllowlist(process.env.ARIA_VOICE_ALLOWED_APPS || 'chrome,edge,notepad,calculator');
const VOICE_ALLOWED_URL_HOSTS = parseAllowlist(process.env.ARIA_VOICE_ALLOWED_URL_HOSTS || '');
const VOICE_BRIGHTNESS_ENABLED = process.env.ARIA_VOICE_ENABLE_BRIGHTNESS === 'true';
const WINDOWS_VOICE_APPS = Object.freeze({ chrome: 'chrome.exe', edge: 'msedge.exe', notepad: 'notepad.exe', calculator: 'calc.exe' });
const { execFile, spawn } = require('node:child_process');

function execFileChecked(file, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error('native_api_failed');
        wrapped.code = 'native_api_failed';
        reject(wrapped);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
function spawnDetachedChecked(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => { const error = new Error('native_api_failed'); error.code = 'native_api_failed'; reject(error); });
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function setWindowsVoiceBrightness(percent) {
  if (!VOICE_BRIGHTNESS_ENABLED) { const error = new Error('operation_unsupported'); error.code = 'operation_unsupported'; throw error; }
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$methods = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods)',
    'if ($methods.Count -eq 0) { exit 42 }',
    '$brightness = ' + percent,
    'foreach ($method in $methods) {',
    '  $result = Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $brightness }',
    '  if ($result.ReturnValue -ne 0) { exit 43 }',
    '}'
  ].join('; ');
  await execFileChecked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 10000);
}
async function openWindowsVoiceApp(appId) {
  const executable = WINDOWS_VOICE_APPS[appId];
  if (!executable) { const error = new Error('app_not_allowlisted'); error.code = 'app_not_allowlisted'; throw error; }
  await spawnDetachedChecked(executable, []);
}
async function openWindowsVoiceUrl(url) {
  await spawnDetachedChecked('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
}
async function runWindowsVoiceCommand(command) {
  return executeVoiceDeviceCommand(command, {
    deviceId: DEVICE_ID,
    allowedApps: VOICE_ALLOWED_APPS,
    allowedUrlHosts: VOICE_ALLOWED_URL_HOSTS,
    adapters: { setBrightness: setWindowsVoiceBrightness, openApp: openWindowsVoiceApp, openUrl: openWindowsVoiceUrl }
  });
}
// Direct voice-device commands use their own short-lived queue; they never use execution_jobs or re-enable mission execution.
async function claimAndExecuteVoiceCommand() {
  try {
    const body = await api('/v1/voice/commands/claim', { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID }), timeoutMs: 8000 });
    if (!body?.command) return 'idle';
    const command = body.command;
    if (!UUID_RE.test(String(command.command_id || ''))) throw new Error('voice_command_id_invalid');
    const outcome = await runWindowsVoiceCommand(command);
    await api('/v1/voice/commands/' + encodeURIComponent(command.command_id) + '/complete', {
      method: 'POST',
      body: JSON.stringify({ status: outcome.status, result: outcome.result, error_code: outcome.errorCode }),
      timeoutMs: 8000
    });
    log('VOICE COMMAND ACK id=' + command.command_id + ' operation=' + String(command.operation) + ' status=' + outcome.status);
    return 'worked';
  } catch (error) {
    console.error('[voice-command] ' + error.message);
    return 'error';
  }
}

const AGENT_HEARTBEAT_PATH=process.env.ARIA_AGENT_HEARTBEAT_PATH||'';
const writeHeartbeatSnapshot=AGENT_HEARTBEAT_PATH?createAtomicHeartbeatWriter(AGENT_HEARTBEAT_PATH):null;
function log(message){console.log(`[ARIA] ${new Date().toISOString()} ${message}`)}
function redact(text){let value=typeof text==='string'?text.slice(-DISPLAY_OUTPUT):'';for(const pattern of[/Bearer\s+[A-Za-z0-9._\-]+/g,/\bsk-[A-Za-z0-9_\-]{8,}/g,/\bor-v1-[A-Za-z0-9_\-]{8,}/g,/gh[pousr]_[A-Za-z0-9_]{20,}/g,/(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi])value=value.replace(pattern,'[redacted]');return value}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
let gatewayHeartbeatInFlight=false;
let lastGatewayHeartbeatAt=null;
let lastGatewayHeartbeatError=null;
let lastGatewayHeartbeatTransport=null;
let heartbeatSequence=0;
const processStartedAt=new Date(Date.now()-process.uptime()*1000).toISOString();
const processStartId=crypto.randomUUID();
const processStartedMonotonicNs=process.hrtime.bigint();
function processMonotonicUptimeMs(){
  return Number((process.hrtime.bigint()-processStartedMonotonicNs)/1000000n);
}
function runtimeEvidenceMetadata(){
  return {
    process_start_id:processStartId,
    process_started_at:processStartedAt,
    process_uptime_monotonic_ms:processMonotonicUptimeMs(),
    heartbeat_sequence:heartbeatSequence,
    event_loop_delay:eventLoopDelaySnapshot()
  };
}
const eventLoopDelayMonitor=monitorEventLoopDelay({resolution:20});
eventLoopDelayMonitor.enable();
function eventLoopDelaySnapshot(){
  const toMs=value=>Number.isFinite(value)?Math.round(value/1e6*100)/100:null;
  const snapshot={
    mean_ms:toMs(eventLoopDelayMonitor.mean),
    p95_ms:toMs(eventLoopDelayMonitor.percentile(95)),
    p99_ms:toMs(eventLoopDelayMonitor.percentile(99)),
    max_ms:toMs(eventLoopDelayMonitor.max)
  };
  eventLoopDelayMonitor.reset();
  return snapshot;
}
async function touchProcessHeartbeat(network='unknown'){
  if(!writeHeartbeatSnapshot)return;
  const payload=JSON.stringify({
    version:'aria-windows-agent-heartbeat-v2',
    timestamp:new Date().toISOString(),
    device_id:DEVICE_ID,
    network,
    process_id:process.pid,
    process_start_id:processStartId,
    process_started_at:processStartedAt,
    process_uptime_ms:Math.round(process.uptime()*1000),
    process_uptime_monotonic_ms:processMonotonicUptimeMs(),
    heartbeat_sequence:heartbeatSequence,
    heartbeat_scheduler_version:'serial-retry-v1',
    gateway_dns_fallback_version:'supabase-scoped-public-fallback-v1',
    event_loop_delay:eventLoopDelaySnapshot(),
    last_gateway_heartbeat_at:lastGatewayHeartbeatAt,
    last_gateway_heartbeat_error:lastGatewayHeartbeatError,
    last_gateway_heartbeat_transport:lastGatewayHeartbeatTransport
  });
  // Local persistence is part of liveness: never acknowledge a remote heartbeat
  // while the canonical Windows heartbeat snapshot is still blocked in the FS queue.
  await writeHeartbeatSnapshot(payload);
}
function normalizeQwenResponse(value){return typeof value==='string'?value.replace(/<think>[\s\S]*?<\/think>/gi,'').trim().slice(0,MAX_OUTPUT):''}
if(!GATEWAY_URL||!DEVICE_TOKEN||!DEVICE_ID){console.error('ARIA agent requires ARIA_DEVICE_GATEWAY_URL, ARIA_DEVICE_TOKEN and ARIA_DEVICE_ID');process.exit(2)}
function endpoint(p){return`${GATEWAY_URL.replace(/\/$/,'')}${p}`} function headers(){return{'content-type':'application/json',authorization:`Bearer ${DEVICE_TOKEN}`,'x-aria-device-id':DEVICE_ID}}
const https = require('node:https');
const nativeGatewayRequest=createGatewayRequest({
  https,
  lookup:gatewayLookup,
  defaultTimeoutMs:GATEWAY_TIMEOUT_MS
});
async function api(p,options={}){
  let lastError=null;
  const heartbeatRequest=p==='/v1/devices/heartbeat';
  const failedHeartbeatAttempts=[];
  const requestId=crypto.randomUUID();
  for(let attempt=0;attempt<=GATEWAY_RETRIES;attempt++){
    try{
      log(`GATEWAY_REQUEST_START id=${requestId} path=${p} attempt=${attempt+1}`);
      const response=await nativeGatewayRequest(endpoint(p),{
        ...options,
        headers:{...headers(),...(options.headers||{}),'x-aria-request-id':requestId,'x-aria-process-start-id':processStartId}
      });
      let body=null;
      try{body=response.text?JSON.parse(response.text):null}catch{body={raw:response.text}}
      if(response.status>=200&&response.status<300){
        if(heartbeatRequest){
          lastGatewayHeartbeatTransport={
            at:new Date().toISOString(),outcome:'success',attempts:attempt+1,
            phase:response.diagnostics?.phase||'complete',
            elapsed_ms:Number.isFinite(response.diagnostics?.elapsed_ms)?response.diagnostics.elapsed_ms:null,
            socket_reused:typeof response.diagnostics?.socket_reused==='boolean'?response.diagnostics.socket_reused:null,
            phase_history:Array.isArray(response.diagnostics?.phase_history)?response.diagnostics.phase_history.slice(-8):[],
            recovered_after_retry:failedHeartbeatAttempts.length>0,
            failed_attempts:failedHeartbeatAttempts.slice(-2)
          };
        }
        log(`GATEWAY_REQUEST_ACK id=${requestId} path=${p} status=${response.status}`);
        return body;
      }
      const error=new Error(`gateway ${response.status}: ${body?.error||'request failed'}`);
      error.status=response.status;
      error.phase='http_response';
      error.elapsed_ms=Number.isFinite(response.diagnostics?.elapsed_ms)?response.diagnostics.elapsed_ms:null;
      error.socket_reused=typeof response.diagnostics?.socket_reused==='boolean'?response.diagnostics.socket_reused:null;
      error.phase_history=Array.isArray(response.diagnostics?.phase_history)?response.diagnostics.phase_history.slice(-8):[];
      error.timeout_kind=null;
      lastError=error;
      const retryable=response.status===408||response.status===429||response.status>=500;
      if(heartbeatRequest&&retryable&&attempt<GATEWAY_RETRIES){
        failedHeartbeatAttempts.push({attempt:attempt+1,code:'http_'+response.status,phase:'http_response',elapsed_ms:error.elapsed_ms,socket_reused:error.socket_reused,timeout_kind:null,status:response.status});
      }
      log(`GATEWAY_REQUEST_ERROR id=${requestId} path=${p} status=${response.status} retryable=${retryable}`);
      if(!retryable||attempt>=GATEWAY_RETRIES)throw error;
    }catch(error){
      lastError=error;
      if(heartbeatRequest){
        const failedAttempt={
          attempt:attempt+1,
          code:typeof error?.code==='string'?error.code:'unknown',
          phase:typeof error?.phase==='string'?error.phase:'unknown',
          elapsed_ms:Number.isFinite(error?.elapsed_ms)?error.elapsed_ms:null,
          socket_reused:typeof error?.socket_reused==='boolean'?error.socket_reused:null,
          timeout_kind:typeof error?.timeout_kind==='string'?error.timeout_kind:null,
          phase_history:Array.isArray(error?.phase_history)?error.phase_history.slice(-8):[],
          status:Number.isInteger(error?.status)?error.status:null
        };
        failedHeartbeatAttempts.push(failedAttempt);
        lastGatewayHeartbeatTransport={
          at:new Date().toISOString(),outcome:attempt>=GATEWAY_RETRIES?'failure':'retrying',
          attempts:attempt+1,phase:failedAttempt.phase,elapsed_ms:failedAttempt.elapsed_ms,
          socket_reused:failedAttempt.socket_reused,timeout_kind:failedAttempt.timeout_kind,
          phase_history:failedAttempt.phase_history,
          failed_attempts:failedHeartbeatAttempts.slice(-2)
        };
      }
      log(`GATEWAY_REQUEST_ERROR id=${requestId} path=${p} code=${error.code||'unknown'} phase=${error.phase||'unknown'} attempt=${attempt+1}`);
      if(attempt>=GATEWAY_RETRIES)throw error;
    }
    await sleep(Math.min(5000,750*Math.pow(2,attempt))+Math.floor(Math.random()*500));
  }
  throw lastError||new Error('gateway_request_failed');
}

function parseAutonomousRwhtPayload(job){
  if(!job||job.device_id!==DEVICE_ID||job.operation!==AUTONOMOUS_COMPUTER_OPERATION)throw new Error('unsupported_job');
  if(typeof job.command!=='string'||!job.command.trim())throw new Error('autonomous_rwht_payload_required');
  let payload;
  try{payload=JSON.parse(job.command)}catch{throw new Error('autonomous_rwht_payload_invalid_json')}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('autonomous_rwht_payload_invalid');
  const keys=Object.keys(payload);
  const allowed=['goal','mode','start_url','max_actions','max_runtime_ms','capture_screenshots'];
  if(keys.some(key=>!allowed.includes(key)))throw new Error('autonomous_rwht_payload_field_rejected');
  if(typeof payload.goal!=='string'||!payload.goal.trim())throw new Error('autonomous_rwht_goal_required');
  if(payload.mode!==undefined&&payload.mode!=='rwht')throw new Error('autonomous_rwht_mode_rejected');
  if(payload.start_url!==undefined&&payload.start_url!==null&&typeof payload.start_url!=='string')throw new Error('autonomous_rwht_start_url_rejected');
  if(payload.max_actions!==undefined&&(!Number.isInteger(payload.max_actions)||payload.max_actions<1||payload.max_actions>500))throw new Error('autonomous_rwht_max_actions_rejected');
  if(payload.max_runtime_ms!==undefined&&(!Number.isInteger(payload.max_runtime_ms)||payload.max_runtime_ms<10_000||payload.max_runtime_ms>900_000))throw new Error('autonomous_rwht_runtime_rejected');
  if(payload.capture_screenshots!==undefined&&typeof payload.capture_screenshots!=='boolean')throw new Error('autonomous_rwht_capture_screenshots_rejected');
  return{
    goal:payload.goal.trim(),
    mode:'rwht',
    start_url:payload.start_url??null,
    max_actions:payload.max_actions??120,
    max_runtime_ms:payload.max_runtime_ms??600_000,
    capture_screenshots:payload.capture_screenshots===true,
  };
}
function parseQwenPayload(job){if(!job||job.device_id!==DEVICE_ID||job.operation!==OLLAMA_OPERATION)throw new Error('unsupported_job');if(typeof job.command!=='string'||!job.command.trim())throw new Error('ollama_payload_required');let payload;try{payload=JSON.parse(job.command)}catch{throw new Error('ollama_payload_invalid_json')}if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('ollama_payload_invalid');const keys=Object.keys(payload);if(keys.some(key=>!['prompt','model','timeout_ms'].includes(key)))throw new Error('ollama_payload_field_rejected');if(typeof payload.prompt!=='string'||!payload.prompt.trim())throw new Error('ollama_prompt_required');if(payload.model!==undefined&&payload.model!==OLLAMA_MODEL)throw new Error('ollama_model_rejected');if(payload.timeout_ms!==undefined&&(!Number.isInteger(payload.timeout_ms)||payload.timeout_ms<1000||payload.timeout_ms>3_600_000))throw new Error('ollama_timeout_rejected');return{prompt:payload.prompt,model:OLLAMA_MODEL,timeout_ms:payload.timeout_ms??job.timeout_ms??120_000}}
async function callOllama({prompt,model,timeout_ms,signal}){
  if(signal&&signal.aborted)return{status:'cancelled',exit_code:null,stdout:'',stderr:'mission_authorization_revoked',duration_ms:0,metadata:{cancelled:true}};
  const controller=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},Math.max(1000,timeout_ms));
  const onAbort=()=>controller.abort();
  if(signal)signal.addEventListener('abort',onAbort,{once:true});
  if(signal&&signal.aborted)onAbort();
  const started=Date.now();
  try{
    const response=await fetch(`${OLLAMA_URL}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,think:false,options:{temperature:0,num_predict:32}}),signal:controller.signal});
    const text=await response.text();
    if(!response.ok)throw new Error(`ollama ${response.status}: ${text.slice(0,1024)}`);
    let body;try{body=JSON.parse(text)}catch{throw new Error('ollama_invalid_json')}
    if(typeof body.response!=='string')throw new Error('ollama_response_missing');
    return{status:'succeeded',exit_code:0,stdout:normalizeQwenResponse(body.response),stderr:'',duration_ms:Date.now()-started,metadata:{raw_response_available:true}};
  }catch(error){
    const status=signal&&signal.aborted?'cancelled':timedOut?'timeout':'failed';
    return{status,exit_code:null,stdout:'',stderr:signal&&signal.aborted?'mission_authorization_revoked':redact(String(error?.message||error).slice(0,4096)),duration_ms:Date.now()-started,metadata:{cancelled:status==='cancelled'}};
  }finally{
    clearTimeout(timer);
    if(signal)signal.removeEventListener('abort',onAbort);
  }
}
async function enroll(){return api('/v1/devices/enroll',{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,token:DEVICE_TOKEN})})}
async function heartbeat(){
  if(gatewayHeartbeatInFlight){
    try{await touchProcessHeartbeat('overlap_skipped')}
    catch(error){console.error(`[heartbeat-file] ${error.message}`)}
    return false;
  }
  gatewayHeartbeatInFlight=true;
  heartbeatSequence+=1;
  const startedAt=Date.now();
  try{
    // Publish local process liveness before making the remote ACK request. If
    // file I/O stalls, the watchdog must see a stale local heartbeat and recover
    // the process instead of reporting remote-online while the observer is blind.
    await touchProcessHeartbeat('attempt');
    const capabilities=[SHELL_OPERATION,COMPUTER_OPERATION,AUTONOMOUS_COMPUTER_OPERATION];
    capabilities.push('app.open','browser.open_url');
    if(VOICE_BRIGHTNESS_ENABLED)capabilities.push('display.brightness.write');
    if(OLLAMA_ENABLED)capabilities.unshift(OLLAMA_OPERATION);
    try{
      await api('/v1/devices/heartbeat',{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,agent_type:'windows-local',capabilities})});
    }catch(error){
      lastGatewayHeartbeatError={at:new Date().toISOString(),status:Number.isInteger(error?.status)?error.status:null,code:typeof error?.code==='string'?error.code:null,phase:typeof error?.phase==='string'?error.phase:null,elapsed_ms:Number.isFinite(error?.elapsed_ms)?error.elapsed_ms:null,socket_reused:typeof error?.socket_reused==='boolean'?error.socket_reused:null,timeout_kind:typeof error?.timeout_kind==='string'?error.timeout_kind:null,message:String(error?.message||error).slice(0,180)};
      try{await touchProcessHeartbeat('transport_error')}
      catch(fileError){console.error(`[heartbeat-file] ${fileError.message}`)}
      console.error(`[heartbeat] ${error.message}`);
      return false;
    }
    lastGatewayHeartbeatAt=new Date().toISOString();
    lastGatewayHeartbeatError=null;
    await touchProcessHeartbeat('online');
    log(`ONLINE device=${DEVICE_ID} capabilities=${capabilities.join(',')}`);
    log(`HEARTBEAT_ACK device=${DEVICE_ID} sequence=${heartbeatSequence} pid=${process.pid} duration_ms=${Date.now()-startedAt} next_interval_ms=${HEARTBEAT_MS}`);
    return true;
  }catch(error){
    console.error(`[heartbeat-file] ${error.message}`);
    return false;
  }finally{
    gatewayHeartbeatInFlight=false;
  }
}
function emitTelemetry(message){try{void Promise.resolve(meditationController.event(message)).catch(error=>console.error(`[meditation] ${error.message}`))}catch(error){console.error(`[meditation] ${error.message}`)}}
async function rejectClaimedJob(job,reason,operation=job?.operation){
  const result={
    status:'failed',exit_code:null,stdout:'',stderr:reason,duration_ms:0,
    metadata:{
      agent_version:'aria-windows-agent-v2',
      operation,
      rejected:true,
      lease_owner:job?.lease_owner||null,
      ...(job?.policy?.mission_wonder_2_a5_recovery===true
        ? {mission_wonder_2_a5_attempt:Math.max(1,Number(job?.metadata?.mission_wonder_2_a5_attempt||1))}
        : {}),
      ...(job?.policy?.mission_wonder_2_a6_continuity===true
        ? {mission_wonder_2_a6_attempt:Math.max(1,Number(job?.metadata?.mission_wonder_2_a6_attempt||1))}
        : {})
    }
  };
  try{
    await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`,{
      method:'POST',
      body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null,result})
    });
  }catch(error){console.error(`[reject] ${error.message}`)}
}
async function readJobAuthorization(job){
  const path='/v1/jobs/'+encodeURIComponent(job.job_id)+'/status';
  const requestId=crypto.randomUUID();
  log(`JOB_AUTH_CHECK_START id=${requestId} job_id=${job.job_id}`);
  const response=await nativeGatewayRequest(endpoint(path),{
    method:'GET',
    headers:{...headers(),'x-aria-request-id':requestId,'x-aria-process-start-id':processStartId},
    timeoutMs:2500
  });
  log(`JOB_AUTH_CHECK_ACK id=${requestId} job_id=${job.job_id} status=${response.status}`);
  let body=null;try{body=response.text?JSON.parse(response.text):null}catch{body=null}
  if(response.status<200||response.status>=300||body?.authorized!==true)throw new Error(String(body?.error||'mission_authorization_revoked'));
  if(job?.lease_owner&&body.lease_owner!==job.lease_owner)throw new Error('execution_lease_lost');
  if(job?.policy?.mission_wonder_2_a6_continuity===true){
    const expectedAttempt=Math.max(1,Number(job?.metadata?.mission_wonder_2_a6_attempt||1));
    if(Number(body.attempt||1)!==expectedAttempt)throw new Error('execution_attempt_fenced');
  }
  return body;
}
async function startJobAuthorizationMonitor(job){
  const controller=new AbortController();let stopped=false,busy=false,timer=null;
  const stop=()=>{stopped=true;if(timer)clearTimeout(timer)};
  const check=async()=>{
    if(stopped||controller.signal.aborted||busy)return;
    busy=true;
    try{const state=await readJobAuthorization(job);if(state.authorized!==true)throw new Error('mission_authorization_revoked')}
    catch(error){controller.abort(error instanceof Error?error:new Error('job_authorization_status_unavailable'))}
    finally{busy=false}
    if(!stopped&&!controller.signal.aborted){timer=setTimeout(()=>{void check()},500);if(timer&&typeof timer.unref==='function')timer.unref()}
  };
  await check();
  return{signal:controller.signal,stop};
}
async function executeShellJob(job){
  let payload;
  try{payload=parseShellJob(job,DEVICE_ID)}catch(error){await rejectClaimedJob(job,String(error.message||'unsupported_shell_job'),SHELL_OPERATION);return}
  log(`JOB RECEIVED id=${job.job_id} operation=${SHELL_OPERATION} cwd=${JSON.stringify(payload.cwd)}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null})});
  const guard=await startJobAuthorizationMonitor(job);let result;
  try{
    result=guard.signal.aborted
      ? {status:'cancelled',exit_code:null,stdout:'',stderr:'mission_authorization_revoked',duration_ms:0,metadata:{cancelled:true}}
      : await executePowerShell({...payload,signal:guard.signal});
  }finally{guard.stop()}
  if(guard.signal.aborted&&result.status!=='cancelled')result={...result,status:'cancelled',exit_code:null,stderr:'mission_authorization_revoked'};
  result.stdout=redact(result.stdout);result.stderr=redact(result.stderr);
  result.metadata={...result.metadata,agent_version:'aria-windows-agent-v2',platform:`windows/${os.release()}`,request_nonce:crypto.randomUUID(),operation:SHELL_OPERATION,lease_owner:job?.lease_owner||null,...runtimeEvidenceMetadata(),...(job?.policy?.mission_wonder_2_a5_recovery===true?{mission_wonder_2_a5_attempt:Math.max(1,Number(job?.metadata?.mission_wonder_2_a5_attempt||1))}:{}),...(job?.policy?.mission_wonder_2_a6_continuity===true?{mission_wonder_2_a6_attempt:Math.max(1,Number(job?.metadata?.mission_wonder_2_a6_attempt||1))}:{})};
  log(`JOB RESULT id=${job.job_id} status=${result.status} exit_code=${result.exit_code} duration_ms=${result.duration_ms}`);
  try{await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null,result})})}
  catch(error){if(!guard.signal.aborted&&error.status!==409)throw error;log(`JOB RESULT already terminal id=${job.job_id}`)}
  emitTelemetry(`JOB RESULT operation=${SHELL_OPERATION} status=${result.status} exit_code=${result.exit_code}`);
}
async function executeOllamaJob(job){
  if(!OLLAMA_ENABLED){await rejectClaimedJob(job,'local_llm_resource_guard:'+RESOURCE_PROFILE.guard_reason,OLLAMA_OPERATION);return}
  let payload;try{payload=parseQwenPayload(job)}catch(error){await rejectClaimedJob(job,String(error.message||'unsupported_qwen_job'),OLLAMA_OPERATION);return}
  log(`JOB RECEIVED id=${job.job_id} operation=${OLLAMA_OPERATION}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null})});
  const guard=await startJobAuthorizationMonitor(job);let result;
  try{result=guard.signal.aborted?{status:'cancelled',exit_code:null,stdout:'',stderr:'mission_authorization_revoked',duration_ms:0}:await callOllama({...payload,signal:guard.signal})}
  finally{guard.stop()}
  if(guard.signal.aborted&&result.status!=='cancelled')result={...result,status:'cancelled',exit_code:null,stderr:'mission_authorization_revoked'};
  result.metadata={...result.metadata,agent_version:'aria-windows-agent-v2',platform:`windows/${os.release()}`,request_nonce:crypto.randomUUID(),operation:OLLAMA_OPERATION,ollama_url:OLLAMA_URL,model:OLLAMA_MODEL};
  log(`JOB RESULT id=${job.job_id} status=${result.status} duration_ms=${result.duration_ms}`);
  if(result.stdout)log(`STDOUT ${JSON.stringify(redact(result.stdout))}`);
  if(result.stderr)log(`STDERR ${JSON.stringify(redact(result.stderr))}`);
  try{await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null,result})})}
  catch(error){if(!guard.signal.aborted&&error.status!==409)throw error;log(`JOB RESULT already terminal id=${job.job_id}`)}
  emitTelemetry(`JOB RESULT operation=${OLLAMA_OPERATION} status=${result.status}`);
}
function loadDesktopExecutor(){const modulePath=require.resolve('./windows-desktop-adapter');delete require.cache[modulePath];const adapter=require(modulePath);if(!adapter||typeof adapter.executeWindowsDesktop!=='function')throw new Error('desktop_adapter_invalid');return adapter}
async function executeAutonomousRwhtJob(job){
  let payload;try{payload=parseAutonomousRwhtPayload(job)}catch(error){await rejectClaimedJob(job,String(error.message||'unsupported_autonomous_computer_use_job'),AUTONOMOUS_COMPUTER_OPERATION);return}
  const deterministicPwaRwht=/(RWHT_CONTROL_DISCOVERY_VERIFY|RWHT\s+PC\s+E2E|ARIA\s+PWA|PWA\s+LIVE)/i.test(payload.goal);
  if(!OLLAMA_ENABLED&&!deterministicPwaRwht){await rejectClaimedJob(job,`local_llm_resource_guard:${RESOURCE_PROFILE.guard_reason}`,AUTONOMOUS_COMPUTER_OPERATION);return}
  log(`JOB RECEIVED id=${job.job_id} operation=${AUTONOMOUS_COMPUTER_OPERATION} mode=${payload.mode}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null})});
  const guard=await startJobAuthorizationMonitor(job);let result;
  try{
    result=guard.signal.aborted?{status:'cancelled',verified:false,verification_status:'cancelled',error:'mission_authorization_revoked'}:
      await runAutonomousRwht({mission_id:job.mission_id||job.job_id,goal:payload.goal,device_id:DEVICE_ID,start_url:payload.start_url,max_actions:payload.max_actions,max_runtime_ms:payload.max_runtime_ms,capture_screenshots:payload.capture_screenshots,signal:guard.signal,on_progress:(event)=>{void api(`/v1/jobs/${encodeURIComponent(job.job_id)}/progress`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,event})}).catch(()=>{})}});
  }catch(error){result={status:guard.signal.aborted?'cancelled':'failed',verified:false,verification_status:guard.signal.aborted?'cancelled':'failed',error:String(error?.message||error)}}
  finally{guard.stop()}
  if(guard.signal.aborted&&result.status!=='cancelled')result={...result,status:'cancelled',verified:false,verification_status:'cancelled',error:'mission_authorization_revoked'};
  const safeResult={...result,exit_code:result?.status==='succeeded'?0:1,stdout:typeof result?.stdout==='string'?redact(result.stdout):'',stderr:typeof result?.error==='string'?redact(result.error):'',metadata:{...(result?.metadata||{}),agent_version:'aria-windows-agent-v2',platform:`windows/${os.release()}`,request_nonce:crypto.randomUUID(),operation:AUTONOMOUS_COMPUTER_OPERATION,mode:payload.mode,capability_awareness:result?.capability_awareness||null}};
  log(`JOB RESULT id=${job.job_id} status=${safeResult.status} verified=${safeResult.verified===true}`);
  try{await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null,result:safeResult})})}
  catch(error){if(!guard.signal.aborted&&error.status!==409)throw error;log(`JOB RESULT already terminal id=${job.job_id}`)}
  emitTelemetry(`JOB RESULT operation=${AUTONOMOUS_COMPUTER_OPERATION} status=${safeResult.status} verified=${safeResult.verified===true}`);
}
async function executeComputerUseJob(job){
  let payload;try{if(!job||job.device_id!==DEVICE_ID||job.operation!==COMPUTER_OPERATION)throw new Error('unsupported_job');payload=typeof job.command==='string'?JSON.parse(job.command):job.command;if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('computer_use_payload_invalid')}
  catch(error){await rejectClaimedJob(job,String(error.message||'invalid_computer_use_job'),COMPUTER_OPERATION);return}
  log(`JOB RECEIVED id=${job.job_id} operation=${COMPUTER_OPERATION} action=${payload.action}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null})});
  const guard=await startJobAuthorizationMonitor(job);let result;
  try{
    result=guard.signal.aborted?{status:'cancelled',action:payload.action,error:'mission_authorization_revoked'}:
      await loadDesktopExecutor().executeWindowsDesktop(payload,{timeout_ms:Number.isInteger(job.timeout_ms)?job.timeout_ms:30_000,signal:guard.signal});
  }catch(error){result={status:guard.signal.aborted?'cancelled':'failed',action:payload.action,error:String(error?.message||error)}}
  finally{guard.stop()}
  if(guard.signal.aborted&&result.status!=='cancelled')result={...result,status:'cancelled',error:'mission_authorization_revoked'};
  const safeResult={...result,stdout:typeof result.stdout==='string'?redact(result.stdout):'',stderr:typeof result.stderr==='string'?redact(result.stderr):'',metadata:{...(result.metadata||{}),agent_version:'aria-windows-agent-v2',platform:`windows/${os.release()}`,request_nonce:crypto.randomUUID(),operation:COMPUTER_OPERATION,action:payload.action}};
  log(`JOB RESULT id=${job.job_id} status=${safeResult.status} action=${payload.action}`);
  try{await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`,{method:'POST',body:JSON.stringify({device_id:DEVICE_ID,lease_owner:job?.lease_owner||null,result:safeResult})})}
  catch(error){if(!guard.signal.aborted&&error.status!==409)throw error;log(`JOB RESULT already terminal id=${job.job_id}`)}
  emitTelemetry(`JOB RESULT operation=${COMPUTER_OPERATION} action=${payload.action} status=${safeResult.status}`);
}
async function claimAndExecute(){try{const body=await api('/v1/jobs/claim',{method:'POST',body:JSON.stringify({device_id:DEVICE_ID})});if(!body?.job)return 'idle';const job=body.job;if(job.device_id!==DEVICE_ID){await rejectClaimedJob(job,'device_id_mismatch',job.operation);return}if(job.operation===SHELL_OPERATION){await executeShellJob(job);return 'worked'}if(job.operation===OLLAMA_OPERATION){await executeOllamaJob(job);return 'worked'}if(job.operation===COMPUTER_OPERATION){await executeComputerUseJob(job);return 'worked'}
if(job.operation===AUTONOMOUS_COMPUTER_OPERATION){await executeAutonomousRwhtJob(job);return 'worked'}await rejectClaimedJob(job,`unsupported_operation:${String(job.operation||'')}`,job.operation);return 'worked'}catch(error){console.error(`[job] ${error.message}`);return 'error'}}
let stopping=false;
const meditationController=createWindowsMeditationController();
process.on('SIGTERM',()=>{stopping=true;void meditationController.shutdown();log('STOP requested')});process.on('SIGINT',()=>{stopping=true;void meditationController.shutdown();log('STOP requested')});
(async()=>{log(`START device=${DEVICE_ID} process_start_id=${processStartId} process_started_at=${processStartedAt} platform=windows-local node=${process.version} resource_profile=${RESOURCE_PROFILE.profile} ram_gb=${RESOURCE_PROFILE.ram_gb} logical_cpus=${RESOURCE_PROFILE.logical_cpus} ollama_enabled=${OLLAMA_ENABLED} guard=${RESOURCE_PROFILE.guard_reason}`);try{await Promise.race([enroll(),sleep(5000).then(()=>{throw new Error('enroll_timeout')})]);log(`ENROLLED device=${DEVICE_ID}`)}catch(error){console.error(`[enroll] ${error.message}`)}const heartbeatLoop=runHeartbeatLoop({
  sendHeartbeat:heartbeat,
  shouldStop:()=>stopping,
  sleep,
  intervalMs:HEARTBEAT_MS,
  retryBaseMs:2_000,
  retryMaxMs:15_000,
  onRetry:({consecutiveFailures,delayMs})=>log(`HEARTBEAT_RETRY device=${DEVICE_ID} consecutive_failures=${consecutiveFailures} retry_in_ms=${delayMs}`)
});
void heartbeatLoop.catch(error=>{console.error(`[heartbeat-loop] ${error.message}`);stopping=true;});let consecutivePollFailures=0;let voiceRetryAt=0;while(!stopping){let voiceState='idle';if(Date.now()>=voiceRetryAt){voiceState=await claimAndExecuteVoiceCommand();if(voiceState==='error')voiceRetryAt=Date.now()+60_000}const state=voiceState==='worked'?'worked':await claimAndExecute();if(state==='error'){consecutivePollFailures=Math.min(consecutivePollFailures+1,6)}else{consecutivePollFailures=0}const baseDelay=state==='worked'?5_000:POLL_MS;const backoff=state==='error'?Math.min(POLL_MS*Math.pow(2,consecutivePollFailures),60_000):baseDelay;const jitter=Math.floor(Math.random()*Math.max(1,Math.min(3_000,Math.round(backoff*0.25))));await sleep(backoff+jitter)}})().catch(error=>{console.error(error);process.exit(1)})
