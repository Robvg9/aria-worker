'use strict';

const { createSelfDevelopmentEngine } = require('../self-development/coordinator');
const { createSelfImprovementEngine } = require('./self-improvement-engine-v1');

function createSelfImprovementCoordinatorV1({ snapshot, rules = [], workspace, testRunner, writer, policy = {}, selfModel = {}, evaluationLedger = null, evaluationSuiteId = 'self-improvement-v1' } = {}) {
  const development = createSelfDevelopmentEngine({
    snapshot,
    rules,
    workspace,
    testRunner,
    writer,
    policy,
    selfModel,
    evaluationLedger,
    evaluationSuiteId
  });

  const engine = createSelfImprovementEngine({
    observe: async ({ signal }) => {
      const inspection = await development.inspector.inspect({ include: signal.scope || development.inspector.allowedScopes });
      return inspection.status === 'succeeded'
        ? { status: 'succeeded', snapshot: inspection.snapshot }
        : inspection;
    },
    research: async ({ signal }) => ({
      status: 'succeeded',
      source: 'aria-self-model',
      objective: signal.goal,
      capability_graph: development.capabilityGraph || null
    }),
    plan: async ({ signal }) => {
      const proposedChanges = Array.isArray(signal.proposed_changes) ? signal.proposed_changes : [];
      const diagnosis = await development.diagnoser.diagnose((await development.inspector.inspect()).snapshot);
      return development.planner.plan({ findings: diagnosis.findings, objective: signal.goal, proposed_changes: proposedChanges });
    },
    build: async ({ signal }) => {
      const result = await development.improve({ objective: signal.goal, proposed_changes: signal.proposed_changes || [], scope: signal.scope || null });
      if (result.status === 'succeeded') return { status: 'succeeded', mode: 'self-development-coordinator', result };
      if (result.status === 'planned') return { status: 'succeeded', mode: 'plan_only', result };
      return { status: result.status || 'failed', result };
    },
    test: async ({ build }) => {
      const tests = build?.result?.tests;
      if (tests?.status === 'succeeded' || tests?.status === 'completed' || tests?.status === 'passed') {
        return { status: 'succeeded', source: 'self-development-coordinator', tests };
      }
      return { status: 'failed', reason: 'coordinator_test_evidence_missing' };
    },
    verify: async ({ build, test }) => {
      const verification = build?.result?.verification;
      const testsVerified = test?.status === 'succeeded' || test?.status === 'completed';
      if (verification?.verified === true && testsVerified) {
        return { status: 'succeeded', source: 'self-development-coordinator', verification };
      }
      return { status: 'failed', reason: 'coordinator_verification_missing', verification: verification || null };
    },
    learn: async ({ build }) => ({
      status: 'succeeded',
      source: 'self-development-coordinator',
      lesson: build?.result?.documentation || build?.result?.objective || 'verified self-improvement path'
    })
  });

  return Object.freeze({ version: 'self-improvement-coordinator-v1', development, engine });
}

module.exports = Object.freeze({ createSelfImprovementCoordinatorV1 });
