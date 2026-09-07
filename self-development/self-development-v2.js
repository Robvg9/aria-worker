'use strict';

const { analyzeCapabilityGaps } = require('./capability-gap-engine');
const { createDevelopmentPlanner } = require('./development-planner-v2');
const { analyzeChangeRisk } = require('./change-risk-analyzer-v2');
const { createSelfDevelopmentSandbox } = require('./sandbox-v2');
const { buildRegression } = require('./regression-builder-v2');

function createSelfDevelopmentV2({ workspace, protectedPaths = [], policy = {}, snapshot = null } = {}) {
  if (!workspace) throw new TypeError('workspace_required');
  const planner = createDevelopmentPlanner({ max_stages: policy.max_stages || 7 });
  const sandbox = createSelfDevelopmentSandbox({ workspace, protectedPaths });

  function analyzeGoal({ goal, required, available, dependencies } = {}) {
    return analyzeCapabilityGaps({ goal, required, available, dependencies });
  }

  function planCapabilityAcquisition({ goal, gaps, context = {} } = {}) {
    return planner.plan({ goal, gaps, context });
  }

  function assessChange({ changes, dependencyGraph = {} } = {}) {
    return analyzeChangeRisk({ changes, protectedPaths, dependencyGraph });
  }

  async function prepareSandbox({ objective, changes = [], seed = '' } = {}) {
    const session = await sandbox.create({ objective, seed });
    for (const change of changes) await sandbox.stage(session.id, change);
    const simulation = await sandbox.run(session.id, { dry_run: true });
    return Object.freeze({ session, simulation });
  }

  async function promoteSandbox({ session_id, verifier, tests } = {}) {
    return sandbox.promote(session_id, { verifier, tests });
  }

  function createRegression({ capability, procedure, evidence, assertions } = {}) {
    return buildRegression({ capability, procedure, evidence, assertions });
  }

  return Object.freeze({ analyzeGoal, planCapabilityAcquisition, assessChange, prepareSandbox, promoteSandbox, createRegression, snapshot });
}

module.exports = Object.freeze({ createSelfDevelopmentV2 });
