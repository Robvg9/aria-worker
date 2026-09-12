'use strict';

const assert = require('node:assert/strict');
const { createAutonomousRuntime } = require('../autonomy/autonomous-runtime');
const { createDesktopMissionPlanner } = require('../autonomy/desktop-mission-planner');
const { createDesktopMissionReplanner } = require('../autonomy/desktop-mission-replanner');

(async () => {
  const calls = [];
  const missionId = 'desktop-runtime-replan-contract';
  const store = {
    mission: {
      mission_id: missionId,
      status: 'queued',
      goal: 'Abre PowerShell',
      checkpoint: {},
      current_step: 0,
      completed_steps: 0,
      attempt_count: 0
    },
    async get(id) { return id === missionId ? this.mission : null; },
    async transition(id, status, patch = {}) { this.mission = { ...this.mission, ...patch, status }; return this.mission; },
    async checkpoint(id, checkpoint, patch = {}) { this.mission = { ...this.mission, ...patch, checkpoint }; return this.mission; }
  };

  const runtime = createAutonomousRuntime({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-placeholder',
    activation: { execute: async () => ({ status: 'succeeded' }) },
    planner: async () => [],
    desktopPlanner: createDesktopMissionPlanner({ device_id: 'windows-test' }),
    desktopSemanticVerification: false,
    desktopReplanning: true,
    replanner: createDesktopMissionReplanner({ max_alternatives: 2 }).replan,
    verify: async ({ step, final }) => {
      if (final) return true;
      if (step?.input?.action === 'observe') return { ok: true, reason: 'observation_ok' };
      return { ok: false, reason: 'focused_process_mismatch', evidence: { focused_title: 'cmd' } };
    },
    device: {
      fetchImpl: async (_url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : {};
        if (String(_url).endsWith('/v1/devices/heartbeat') || String(_url).endsWith('/v1/devices/enroll')) return { ok: true, json: async () => ({}) };
        if (String(_url).endsWith('/v1/jobs/claim')) return { ok: true, json: async () => ({ job: null }) };
        if (String(_url).includes('/v1/jobs/')) return { ok: true, json: async () => ({ status: 'succeeded', device_id: body.device_id }) };
        return { ok: true, json: async () => ({}) };
      }
    },
    now: () => '2026-09-12T20:30:00.000Z'
  });

  runtime.missionStore.get = store.get;
  runtime.missionStore.transition = store.transition;
  runtime.missionStore.checkpoint = store.checkpoint;

  assert.equal(runtime.desktop.replanning, true);
  assert.equal(typeof runtime.orchestrator.run, 'function');
  assert.equal(typeof runtime.desktop.planner.plan, 'function');

  const direct = runtime.desktop.planner.plan({ goal: 'Abre PowerShell y verifica el estado' });
  calls.push(direct);
  assert.equal(direct.status, 'planned');
  assert.ok(direct.steps.length > 0);
  assert.equal(direct.steps[0].target.device_id, 'windows-test');

  const replanner = createDesktopMissionReplanner({ max_alternatives: 2 });
  const replacement = await replanner.replan({
    mission: { target: { device_id: 'windows-test' } },
    failed_step: direct.steps.find(step => step.input?.action === 'focus') || direct.steps[0],
    outcome: { verification: { reason: 'focused_process_mismatch' } },
    replan_count: 0
  });
  assert.equal(replacement.length, 2);
  assert.equal(replacement[0].input.action, 'observe');

  console.log('DESKTOP RUNTIME REPLANNING INTEGRATION: PASS');
})().catch(error => { console.error(error); process.exit(1); });
