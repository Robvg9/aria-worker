'use strict';

const fs = require('node:fs');
const path = require('node:path');
const security = require('../security/omniroute-security.js');
const execution = require('../execution/lookup.js');
const { runCanonical, createCheckpointStore } = require('../execution/omniroute-canonical-e2e.js');

const evidencePath = process.env.OMNIROUTE_FINAL_EVIDENCE_PATH || path.join(process.cwd(), 'omniroute-final-live-evidence.json');
const missionId = 'omniroute-final-live-20261005';
const marker = 'OMNIROUTE_QWEN_LIVE_OK';
const endpoint = process.env.OMNIROUTE_FINAL_ENDPOINT || 'http://127.0.0.1:20130/v1/chat/completions';
const apiKey = process.env.OMNIROUTE_API_KEY || '';
if (!apiKey) throw new Error('OMNIROUTE_API_KEY missing');
const dataDir = path.dirname(evidencePath);
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
  model_id: 'ollama/qwen3:4b', capability: 'text_generation', task_id: missionId, latency_ms: 1, cost_usd: 0, offline: true, local: true,
  evidence: { source: 'aria.router.allowed_set', evidence_id: 'live-gateway-omniroute-ollama-qwen-20261005', target_id: missionId, provider_id: 'omniroute', model_id: 'ollama/qwen3:4b' }
};

(async () => {
  await store.create({ mission_id: missionId, goal: task, status: 'running', current_step: 0, total_steps: 1, completed_steps: 0, next_action: 'execute_selected_route', checkpoint: {} });
  const result = await runCanonical({
    task_id: missionId, task, mission_id: missionId, capability: 'text_generation', mode: 'auto/offline', allowed_routes: [allowedRoute],
    security: { gateway_endpoint: endpoint, provider_id: 'omniroute', provider_allowlist: ['omniroute'], credential_ref: 'env://OMNIROUTE_API_KEY', timeout_ms: 120000, origin: 'http://127.0.0.1:20130', allowed_origins: ['http://127.0.0.1:20130'], input: { task, mission_id: missionId } },
    omniroute_provider: 'ollama',
    payload: { messages: [{ role: 'user', content: task }], temperature: 0, stream: false },
    authorization: { status: 'approved' },
    execution_deps: {
      candidateSelectable: () => true, getModel: () => ({ provider_id: 'omniroute', status: 'available' }), isAccountActive: () => true,
      supports: () => true, capacityAllows: () => true, credentialRefOf: () => 'env://OMNIROUTE_API_KEY',
      credentialResolver: { resolver_id: 'final-live-env-test', async resolve() { return { status: 'resolved', secret: apiKey }; } },
      transport: execution.defaultTransport
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
})();
