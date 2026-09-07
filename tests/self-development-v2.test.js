'use strict';

const assert = require('assert/strict');
const { analyzeCapabilityGaps } = require('../self-development/capability-gap-engine');
const { createDevelopmentPlanner } = require('../self-development/development-planner-v2');
const { analyzeChangeRisk } = require('../self-development/change-risk-analyzer-v2');
const { createSelfDevelopmentSandbox } = require('../self-development/sandbox-v2');
const { buildRegression, evaluateRegression } = require('../self-development/regression-builder-v2');
const { createSelfDevelopmentV2 } = require('../self-development/self-development-v2');

(async () => {
  const gaps = analyzeCapabilityGaps({
    goal: 'automate web task',
    required: ['planner', 'browser_state_perception', 'dom_recovery', 'login_state_persistence'],
    available: [
      { id: 'planner', status: 'verified', confidence: 0.99 },
      { id: 'browser_state_perception', status: 'unknown' }
    ],
    dependencies: { dom_recovery: ['browser_state_perception'], login_state_persistence: ['browser_state_perception'] }
  });
  assert.equal(gaps.status, 'gaps_detected');
  assert.equal(gaps.gap_count, 3);
  assert.equal(gaps.satisfied[0].capability_id, 'planner');
  assert.equal(gaps.gaps[0].priority, 'high');
  assert.deepEqual(gaps.gaps.map(x => x.capability_id), ['browser_state_perception', 'dom_recovery', 'login_state_persistence']);

  const planner = createDevelopmentPlanner();
  const developmentPlan = planner.plan({ goal: gaps.goal, gaps: gaps.gaps });
  assert.equal(developmentPlan.status, 'planned');
  assert.equal(developmentPlan.steps[0].stage, 'research');
  assert.equal(developmentPlan.steps.at(-1).stage, 'promote');
  assert.equal(developmentPlan.steps.filter(x => x.capability_id === 'dom_recovery').length, 7);

  const risk = analyzeChangeRisk({
    changes: [
      { type: 'modify_file', path: 'self-development/new.js' },
      { type: 'delete_file', path: 'danger.js' },
      { type: 'modify_file', path: 'migrations/001.sql' }
    ],
    protectedPaths: ['production.js'],
    dependencyGraph: { 'migrations/001.sql': ['a', 'b', 'c'] }
  });
  assert.equal(risk.max_risk, 'destructive');
  assert.equal(risk.approval_requirement, 'elevated_review');
  assert.equal(risk.changes.find(x => x.path === 'migrations/001.sql').risk_level, 'high');

  const state = { files: new Map([['safe.js', 'old']]) };
  const workspace = {
    async createBranch(branch, base) { assert.match(branch, /^aria\/self-development\//); assert.equal(base, 'main'); return { branch }; },
    async read(path, branch) { assert.match(branch, /^aria\/self-development\//); return { path, branch, content: state.files.get(path) || null }; },
    async apply(change) { assert.match(change.branch, /^aria\/self-development\//); state.files.set(change.path, change.content); return { status: 'succeeded', branch: change.branch }; },
    async openPullRequest({ branch }) { assert.match(branch, /^aria\/self-development\//); return { number: 123 }; }
  };
  const sandbox = createSelfDevelopmentSandbox({ workspace, protectedPaths: ['production.js'] });
  const session = await sandbox.create({ objective: 'learn capability', seed: 'x' });
  assert.match(session.branch, /^aria\/self-development\//);
  await sandbox.stage(session.id, { type: 'modify_file', path: 'safe.js', content: 'new' });
  const dry = await sandbox.run(session.id);
  assert.equal(dry.mode, 'dry_run');
  assert.equal(state.files.get('safe.js'), 'old');
  const applied = await sandbox.run(session.id, { apply: true });
  assert.equal(applied.mode, 'sandbox_apply');
  assert.equal(state.files.get('safe.js'), 'new');
  await assert.rejects(() => sandbox.stage(session.id, { type: 'modify_file', path: 'production.js', content: 'bad' }), /protected_path/);
  const blocked = await sandbox.promote(session.id, { verifier: async () => ({ passed: false }) });
  assert.equal(blocked.status, 'blocked');
  const pending = await sandbox.promote(session.id, { verifier: async () => ({ passed: true, checks: ['tests', 'security'] }) });
  assert.equal(pending.status, 'promotion_pending');
  assert.equal(pending.pull_request, 123);

  const regression = buildRegression({
    capability: 'browser_state_perception',
    procedure: { steps: ['observe', 'normalize'] },
    evidence: { mission_id: 'm1', confidence: 0.95 }
  });
  assert.equal(regression.status, 'generated');
  const regressionResult = evaluateRegression(regression, { capability: { status: 'verified' }, procedure: { steps: ['observe'] } });
  assert.equal(regressionResult.status, 'passed');
  const failingRegression = evaluateRegression(regression, { capability: { status: 'active' }, procedure: { steps: [] } });
  assert.equal(failingRegression.status, 'failed');

  const facade = createSelfDevelopmentV2({ workspace, protectedPaths: ['production.js'] });
  const facadeGaps = facade.analyzeGoal({ goal: 'demo', required: ['a'], available: [] });
  assert.equal(facadeGaps.gap_count, 1);
  assert.equal(facade.planCapabilityAcquisition({ goal: 'demo', gaps: facadeGaps.gaps }).steps.length, 7);
  assert.equal(facade.assessChange({ changes: [{ type: 'modify_file', path: 'x.js' }] }).max_risk, 'medium');

  console.log('SELF-DEVELOPMENT 2.0: PASS — capability gaps, acquisition planning, sandbox isolation, risk analysis, regression generation, and governed facade');
})();
