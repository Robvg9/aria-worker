'use strict';

const assert = require('node:assert/strict');
const { createAutonomousMissionOrchestrator } = require('../autonomy/orchestrator');
const { createDesktopMissionPlanner } = require('../autonomy/desktop-mission-planner');
const { createDesktopMissionReplanner } = require('../autonomy/desktop-mission-replanner');

(async () => {
  const missionId = 'desktop-cloud-e2e';
  const store = {
    mission: {
      mission_id: missionId,
      status: 'queued',
      goal: 'Abre PowerShell y verifica el estado',
      checkpoint: {},
      current_step: 0,
      completed_steps: 0,
      attempt_count: 0
    },
    async get(id) { return id === missionId ? this.mission : null; },
    async transition(id, status, patch = {}) { this.mission = { ...this.mission, ...patch, status }; return this.mission; },
    async checkpoint(id, checkpoint, patch = {}) { this.mission = { ...this.mission, ...patch, checkpoint }; return this.mission; }
  };

  const planner = createDesktopMissionPlanner({ device_id: 'windows-sim' });
  const replanner = createDesktopMissionReplanner({ max_alternatives: 2 });
  let focusAttempts = 0;
  const executed = [];

  const executor = async ({ step }) => {
    executed.push({ id: step.id, action: step.input?.action || null });
    if (step.operation === 'computer.use' && step.input?.action === 'focus') {
      focusAttempts += 1;
      if (focusAttempts === 1) return { status: 'failed', error: 'window_not_found' };
      return { status: 'succeeded', ui: { nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true }] } };
    }
    if (step.operation === 'computer.use' && step.input?.action === 'observe') {
      return { status: 'succeeded', ui: { nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true }] } };
    }
    if (step.operation === 'computer.use' && step.input?.action === 'open') {
      return { status: 'succeeded', path: step.input.path, ui: { nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true }] } };
    }
    return { status: 'succeeded' };
  };

  const verify = async ({ step, result, final = false }) => {
    if (final) return { ok: true, evidence: { source: 'desktop-cloud-e2e' } };
    if (step.input?.action === 'focus') {
      if (result.status !== 'succeeded') return { ok: false, reason: 'focused_process_mismatch', confidence: 0.2, evidence: { focused_title: 'Desktop' } };
      return { ok: true, reason: 'semantic_expectation_satisfied', confidence: 0.95, evidence: { focused_title: 'Windows PowerShell', nodes: [{ role: 'window', name: 'Windows PowerShell', visible: true }] } };
    }
    return { ok: result.status === 'succeeded', reason: result.status === 'succeeded' ? 'result_only' : 'action_failed' };
  };

  const orchestrator = createAutonomousMissionOrchestrator({
    missionStore: store,
    planner: async ({ mission, policy }) => planner.plan({ goal: mission.goal, constraints: policy }),
    replanner: replanner.replan,
    executor,
    verify,
    policy: {
      enabled: true,
      max_risk: 'low',
      max_steps: 12,
      max_parallel: 1,
      max_attempts_per_step: 1,
      max_replans: 2,
      require_human_approval: false
    },
    now: () => '2026-09-12T20:40:00.000Z'
  });

  const result = await orchestrator.run(missionId);
  assert.equal(result.status, 'succeeded');
  assert.equal(store.mission.status, 'succeeded');
  assert.ok(store.mission.checkpoint.evidence_log.length >= 2);
  assert.ok(store.mission.checkpoint.replan_count >= 1);
  assert.equal(focusAttempts >= 2, true);
  assert.ok(executed.some(item => item.action === 'observe'));
  assert.ok(executed.some(item => item.action === 'focus'));
  assert.equal(store.mission.final_evidence.source, 'desktop-cloud-e2e');

  console.log('DESKTOP CLOUD E2E: PASS — goal → desktop plan → execution → evidence → failure → replan → recovery → final verification');
})().catch(error => { console.error(error); process.exit(1); });
