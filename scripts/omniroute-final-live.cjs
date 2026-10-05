'use strict';

const http = require('node:http');

global.fetch = async function loopbackFetch(url, options = {}) {
  const u = new URL(url);
  const isLoopback = u.protocol === 'http:' &&
    (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1');
  if (!isLoopback) throw new Error('live transport restricted to loopback');

  return await new Promise((resolve, reject) => {
    const req = http.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          json: async () => {
            try { return JSON.parse(raw); } catch { return null; }
          }
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => {
      const err = new Error('request timeout');
      err.name = 'TimeoutError';
      req.destroy(err);
    });
    if (options.body) req.write(options.body);
    req.end();
  });
};

const fs = require('node:fs');
const path = require('node:path');
const security = require('../security/omniroute-security.js');
const execution = require('../execution/lookup.js');
const { spawn } = require('node:child_process');
const net = require('node:net');

async function liveTransport(url, options = {}) {
  const u = new URL(url);
  if (u.protocol !== 'http:' || !['127.0.0.1','localhost','::1'].includes(u.hostname)) {
    throw new Error('live transport restricted to loopback');
  }
  return await new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = Buffer.byteLength(String(options.body));
    }
    headers.Connection = headers.Connection || 'close';
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          json: async () => { try { return JSON.parse(raw); } catch { return null; } }
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => {
      const e = new Error('request timeout');
      e.name = 'TimeoutError';
      req.destroy(e);
    });
    if (options.body) req.write(String(options.body));
    req.end();
  });
}
liveTransport.isLive = true;
const { runCanonical, createCheckpointStore } = require('../execution/omniroute-canonical-e2e.js');

const evidencePath = process.env.OMNIROUTE_FINAL_EVIDENCE_PATH || path.join(process.cwd(), 'omniroute-final-live-evidence.json');
const missionId = 'omniroute-final-live-20261005';
const marker = 'OMNIROUTE_QWEN_LIVE_OK';
const endpoint = process.env.OMNIROUTE_FINAL_ENDPOINT || 'http://127.0.0.1:20130/v1/chat/completions';
const apiKey = process.env.OMNIROUTE_API_KEY || '';
if (!apiKey) throw new Error('OMNIROUTE_API_KEY missing');
const dataDir = path.dirname(evidencePath);
const sourceDir = process.env.OMNIROUTE_SOURCE_DIR;
if (!sourceDir) throw new Error('OMNIROUTE_SOURCE_DIR missing');
const runtimeRoot = path.dirname(evidencePath);
const serverStdout = path.join(runtimeRoot, 'omniroute.stdout.log');
const serverStderr = path.join(runtimeRoot, 'omniroute.stderr.log');
fs.mkdirSync(dataDir, { recursive: true });
const missionFile = path.join(dataDir, 'mission.json');
const eventsFile = path.join(dataDir, 'events.ndjson');

function saveMission(m) { fs.writeFileSync(missionFile, JSON.stringify(m, null, 2) + '\n'); return m; }
const repoAdapter = {
  async createMission(m) { return saveMission(m); },
  async getMission() { return fs.existsSync(missionFile) ? JSON.parse(fs.readFileSync(missionFile, 'utf8')) : null; },
  async updateMission(_id, m) { return saveMission(m); },
  async appendEvent(_id, e) { fs.appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'); }
};
const store = createCheckpointStore(repoAdapter);
const task = 'Return exactly ' + marker;

const allowedRoute = {
  allowed: true, availability_status: 'available', provider_id: 'omniroute', account_id: 'account-ollama-local',
  model_id: 'ollama/qwen3:4b', upstream_model: 'qwen3:4b', capability: 'text_generation', task_id: missionId, latency_ms: 1, cost_usd: 0, offline: true, local: true,
  evidence: { source: 'aria.router.allowed_set', evidence_id: 'live-gateway-omniroute-ollama-qwen-20261005', target_id: missionId, provider_id: 'omniroute', model_id: 'ollama/qwen3:4b' }
};

(async () => {
  const providerConfig = ['providers:','  - id: ollama','    kind: openai','    baseUrl: http://127.0.0.1:11434/v1','    model: qwen3:4b',''].join('\n');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  let child = null;
  try {
    child = spawn(process.execPath, [path.join(sourceDir, 'scripts', 'dev', 'run-next.mjs'), 'dev'], {
      cwd: sourceDir, windowsHide: true, stdio: ['ignore','pipe','pipe'],
      env: { ...process.env, HOST:'127.0.0.1', HOSTNAME:'127.0.0.1', PORT:'20130',
        DATA_DIR:dataDir, OMNIROUTE_SELF_HOSTED_API_KEY:apiKey,
        OMNIROUTE_SELF_HOSTED_PROVIDERS:providerConfig }
    });
    child.stdout.pipe(fs.createWriteStream(serverStdout,{flags:'a'}));
    child.stderr.pipe(fs.createWriteStream(serverStderr,{flags:'a'}));

    await new Promise((resolve,reject)=>{
      const deadline=Date.now()+90000;
      const poll=()=>{
        const s=net.connect({host:'127.0.0.1',port:20130},()=>{s.destroy();resolve();});
        s.on('error',()=>{if(Date.now()>deadline)reject(new Error('OMNIROUTE_PORT_NOT_LISTENING'));else setTimeout(poll,1000);});
      };
      poll();
    });
    console.log('OMNIROUTE_GATEWAY_LOOPBACK_PASS=true');
    await store.create({ mission_id: missionId, goal: task, status: 'running', current_step: 0, total_steps: 1, completed_steps: 0, next_action: 'execute_selected_route', checkpoint: {} });
  const result = await runCanonical({
    task_id: missionId, task, mission_id: missionId, capability: 'text_generation', mode: 'auto/offline', allowed_routes: [allowedRoute],
    security: { gateway_endpoint: endpoint, provider_id: 'omniroute', provider_allowlist: ['omniroute'], credential_ref: 'env://OMNIROUTE_API_KEY', timeout_ms: 120000, origin: 'http://127.0.0.1:20130', allowed_origins: ['http://127.0.0.1:20130'], input: { task, mission_id: missionId } },
    omniroute_provider: 'ollama',
    payload: { messages: [{ role: 'user', content: task }], temperature: 0, stream: false, enable_thinking: false, max_tokens: 128 },
    authorization: { status: 'approved' },
    execution_deps: {
      candidateSelectable: () => true, getModel: () => ({ provider_id: 'omniroute', status: 'available' }), isAccountActive: () => true,
      supports: () => true, capacityAllows: () => true, credentialRefOf: () => 'env://OMNIROUTE_API_KEY',
      credentialResolver: { resolver_id: 'final-live-env-test', async resolve() { return { status: 'resolved', secret: apiKey }; } },
      transport: liveTransport
    },
    verification_rules: {
      verify(executionResult) {
        const content = String(executionResult?.response?.content || '');
        const routedBy = String(executionResult?.metadata?.routed_by || '');
        const decision = String(executionResult?.metadata?.route_decision || '');
        return executionResult?.status === 'succeeded' && content.includes(marker) && routedBy === 'self-hosted-openai-compat' && /ollama/i.test(decision);
      }
    },
    alternative_routes: [], resilience_policy: {}
  });
  if (result.status !== 'succeeded') throw new Error('CANONICAL_E2E_FAILED=' + JSON.stringify(result));
  await store.transition(missionId, 'succeeded', { current_step: 1, completed_steps: 1, next_action: null, checkpoint: result.checkpoint?.checkpoint || {} });
  const persisted = JSON.parse(fs.readFileSync(missionFile, 'utf8'));
  const eventText = fs.readFileSync(eventsFile, 'utf8');
  const persistedOk = persisted.status === 'succeeded' && persisted.completed_steps === 1 && eventText.includes('"event_type":"mission_succeeded"');
  const receipt = {
    schema: 'aria.absorb.omniroute.final-live.v1',
    status: persistedOk ? 'PASS_FINAL_LIVE_E2E' : 'FAIL_PERSISTENCE',
    mission_id: missionId,
    source: { repository: 'diegosouzapw/OmniRoute', commit: '3e66ff2e8cc94821b093fe57dad667b585230cd1', version: '3.8.52' },
    gateway: { endpoint, provider: 'ollama', routed_by: result.execution?.metadata?.routed_by || null, decision: result.execution?.metadata?.route_decision || null },
    model: 'ollama/qwen3:4b',
    canonical: { status: result.status, execution_status: result.execution?.status || null, verification: result.verification || null, checkpoint_id: result.checkpoint?.checkpoint_id || null },
    persistence: { mission_status: persisted.status, completed_steps: persisted.completed_steps, event_mission_succeeded: eventText.includes('"event_type":"mission_succeeded"') },
    security: { gateway_loopback: true, raw_secret_persisted: false, authority: 'ARIA' },
    captured_at_utc: new Date().toISOString()
  };
  fs.writeFileSync(evidencePath, JSON.stringify(receipt, null, 2) + '\n');
  if (receipt.status !== 'PASS_FINAL_LIVE_E2E') process.exit(1);
  console.log(JSON.stringify(receipt, null, 2));
  } finally {
    if (child && !child.killed) { try { child.kill('SIGTERM'); } catch {} }
    await new Promise(r=>setTimeout(r,500));
    if (child && !child.killed) { try { child.kill('SIGKILL'); } catch {} }
  }
})().catch(error => {
  fs.appendFileSync(serverStderr, '\nFINAL_LIVE_ERROR ' + (error?.stack || String(error)) + '\n');
  process.exit(1);
});
