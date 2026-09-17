'use strict';

const { createAutonomyFrontier } = require('./autonomy-frontier-v1');
const { createContinuousEvolutionV2 } = require('./continuous-evolution-v2');

const SAFE_CATEGORIES = new Set(['reliability', 'performance', 'documentation', 'observability', 'capability_gap', 'regression']);

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 1000) : fallback;
}

function assertSignal(signal) {
  if (!signal || typeof signal !== 'object') throw new TypeError('improvement signal required');
  const goal = normalizeString(signal.goal || signal.title);
  if (!goal) throw new TypeError('improvement goal required');
  return { ...signal, goal };
}

function createSelfImprovementEngine({
  frontier = createAutonomyFrontier(),
  observe,
  research,
  plan,
  build,
  test,
  verify,
  learn,
  promote = async () => ({ status: 'skipped', reason: 'promotion_requires_human_gate' }),
  deploy = async () => ({ status: 'skipped', reason: 'deployment_requires_human_gate' })
} = {}) {
  const required = { observe, research, plan, build, test, verify, learn };
  for (const [name, fn] of Object.entries(required)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} function required`);
  }

  async function run(signalInput = {}) {
    const signal = assertSignal(signalInput);
    const classification = frontier.assess({ ...signal, goal: signal.goal }).classification;

    if (!classification.executable) {
      return Object.freeze({
        status: 'blocked',
        version: 'self-improvement-v1',
        goal: signal.goal,
        classification,
        stop_reason: 'autonomy_frontier'
      });
    }

    if (signal.category && !SAFE_CATEGORIES.has(signal.category)) {
      return Object.freeze({
        status: 'blocked',
        version: 'self-improvement-v1',
        goal: signal.goal,
        classification,
        stop_reason: 'category_not_autonomous'
      });
    }

    const engine = createContinuousEvolutionV2({
      observe: async context => observe({ signal, ...context }),
      diagnose: async context => ({
        status: 'succeeded',
        category: signal.category || 'capability_gap',
        confidence: Number.isFinite(signal.confidence) ? signal.confidence : 0.8,
        ...context
      }),
      research: async context => research({ signal, ...context }),
      plan: async context => plan({ signal, ...context }),
      build: async context => build({ signal, ...context }),
      test: async context => test({ signal, ...context }),
      security: async context => ({
        status: 'succeeded',
        policy: 'autonomous-safe',
        checks: ['frontier', 'category', 'no-production-promotion', 'no-deployment'],
        ...context
      }),
      evaluate: async context => {
        const testStatus = context.results?.test?.status || context.test?.status;
        return testStatus === 'succeeded' || testStatus === 'completed'
          ? { status: 'succeeded', basis: 'tests_passed' }
          : { status: 'failed', reason: 'test_result_not_verified' };
      },
      promote,
      deploy,
      verify: async context => verify({ signal, ...context }),
      learn: async context => learn({ signal, ...context }),
      maxCycles: 1
    });

    const result = await engine.run({ signal, approvals: { promote: signal.approve_promote === true, deploy: signal.approve_deploy === true } });
    return Object.freeze({
      ...result,
      engine: 'self-improvement-v1',
      goal: signal.goal,
      classification
    });
  }

  return Object.freeze({ version: 'self-improvement-v1', safe_categories: Object.freeze([...SAFE_CATEGORIES]), run, frontier });
}

module.exports = Object.freeze({ SAFE_CATEGORIES, createSelfImprovementEngine });
