'use strict';

const assert = require('node:assert/strict');
const { createAutonomousMissionOrchestrator } = require('../autonomy/orchestrator');
const { createBattleCruiserBridge } = require('../autonomy/battlecruiser/runtime-bridge');

(async () => {
  const missionId = 'bc6-autonomous-proof';
  const branch = 'aria/sandbox/bc6-autonomous-proof';
  const store = {
    mission: { id: missionId, status: 'queued', checkpoint: null, current_step: 0, completed_steps: 0 },
    async get(id) { return id === missionId ? this.mission : null; },
    async transition(id, status, patch = {}) { this.mission = { ...this.mission, ...patch, status }; return this.mission; },
    async checkpoint(id, checkpoint, patch = {}) { this.mission = { ...this.mission, ...patch, checkpoint }; return this.mission; }
  };

  const workspace = {
    async createBranch(value) { assert.equal(value, branch); },
    async read() { return { content: 'before' }; },
    async apply(change) { assert.equal(change.branch, branch); return { status: 'succeeded', data: { path: change.path } }; },
    async openPullRequest(args) {
      assert.equal(args.branch, branch);
      assert.match(args.title, /BattleCruiser/);
      return { number: 777, html_url: 'https://github.com/Robvg9/battlecruiser/pull/777' };
    }
  };
  const bridge = createBattleCruiserBridge({
    workspace,
    executor: { execute: async ({ step }) => workspace.apply({ ...step.input, branch }) }
  });

  const planner = async () => [
    { id: 'inspect', operation: 'repo_read', target: { type: 'connector', connector_id: 'github' }, risk: 'low', retryable: false },
    { id: 'write', operation: 'file_write', target: { type: 'connector', connector_id: 'github' }, input: { path: 'docs/bc6-autonomous-proof.md', content: 'proof' }, risk: 'low', retryable: false }
  ];

  const executed = [];
  let finalBridgeRun = null;
  const executor = async ({ step }) => {
    executed.push(step.id);
    if (step.id === 'inspect') return { status: 'succeeded', data: { ok: true } };
    finalBridgeRun = await bridge.run({
      repository: 'Robvg9/battlecruiser',
      branch,
      files: [step.input.path],
      changes: [step.input],
      evaluationCases: [{ id: 'written', run: async () => true, expect: value => value === true }],
      baseline: { status: 'passed', total: 1, passed: 1, failed: 0, results: [{ id: 'written', status: 'passed' }] }
    });
    return { status: finalBridgeRun.status === 'passed' ? 'succeeded' : 'failed', data: finalBridgeRun };
  };

  const verify = async ({ result, final = false }) => final ? true : result?.status === 'succeeded';
  const orchestrator = createAutonomousMissionOrchestrator({
    missionStore: store,
    planner,
    executor,
    verify,
    policy: { enabled: true, max_risk: 'low', max_steps: 5, max_parallel: 1, max_attempts_per_step: 1, require_human_approval: false }
  });

  const result = await orchestrator.run(missionId);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(executed, ['inspect', 'write']);
  assert.equal(store.mission.status, 'succeeded');
  assert.equal(finalBridgeRun?.promotion?.decision, 'open_pull_request');
  assert.equal(finalBridgeRun?.promotion?.status, 'approved');

  const promoted = await bridge.promote({
    evaluation: finalBridgeRun.evaluation,
    branch,
    title: 'feat: ARIA governed BattleCruiser candidate'
  });
  assert.equal(promoted.status, 'approved');
  assert.equal(promoted.decision, 'open_pull_request');
  assert.equal(promoted.pr.number, 777);

  console.log('BATTLECRUISER AUTONOMOUS MISSION: PASS — orchestrator → sandbox → regression → evaluation → promotion decision → PR contract');
})().catch(error => { console.error(error); process.exit(1); });
