'use strict';

const assert = require('node:assert/strict');
const { createAutonomousMissionOrchestrator, evidenceSummary } = require('../autonomy/orchestrator');

(async () => {
  const missionId = 'desktop-evidence-contract';
  const store = {
    mission: { id: missionId, status: 'queued', checkpoint: null, current_step: 0, completed_steps: 0 },
    async get(id) { return id === missionId ? this.mission : null; },
    async transition(id, status, patch = {}) { this.mission = { ...this.mission, ...patch, status }; return this.mission; },
    async checkpoint(id, checkpoint, patch = {}) { this.mission = { ...this.mission, ...patch, checkpoint }; return this.mission; }
  };

  const planner = async () => [{
    id: 'focus', operation: 'computer.use', action: 'focus',
    target: { type: 'device', device_id: 'windows-test' },
    input: { action: 'focus', process: 'powershell' },
    risk: 'READ', retryable: false
  }];

  const executor = async () => ({
    status: 'succeeded',
    ui: { title: 'Windows PowerShell', nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true }] }
  });

  const verify = async ({ final = false }) => final ? { ok: true, evidence: { source: 'contract' } } : ({
    ok: true,
    reason: 'semantic_expectation_satisfied',
    confidence: 0.95,
    evidence: {
      focused_title: 'Windows PowerShell',
      nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true }]
    }
  });

  const orchestrator = createAutonomousMissionOrchestrator({
    missionStore: store,
    planner,
    executor,
    verify,
    policy: { enabled: true, max_risk: 'READ', max_steps: 4, max_parallel: 1, max_attempts_per_step: 1 }
  });

  const result = await orchestrator.run(missionId);
  assert.equal(result.status, 'succeeded');
  assert.equal(store.mission.status, 'succeeded');
  assert.equal(store.mission.checkpoint.evidence_log.length, 1);
  assert.equal(store.mission.checkpoint.last_evidence.evidence.focused_title, 'Windows PowerShell');
  assert.equal(store.mission.final_evidence.source, 'contract');

  const summary = evidenceSummary({
    step: { id: 'x', operation: 'computer.use' },
    result: { status: 'succeeded' },
    verification: { ok: true, confidence: 0.9, evidence: { nodes: Array.from({ length: 100 }, (_, i) => ({ name: `n${i}`, role: 'window' })) } },
    attempt: 1
  });
  assert.equal(summary.evidence.node_count, 100);
  assert.equal(summary.evidence.nodes.length, 50);

  console.log('DESKTOP EVIDENCE CHECKPOINT: PASS');
})().catch(error => { console.error(error); process.exit(1); });
