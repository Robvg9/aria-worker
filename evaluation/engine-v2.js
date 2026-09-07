'use strict';

const crypto = require('node:crypto');

const VERSION = 'evaluation-engine-v2.0.0';
const REQUIRED_STAGES = Object.freeze(['unit', 'integration', 'security', 'behavior', 'regression', 'live']);
const STATUS_PASS = 'passed';
const STATUS_FAIL = 'failed';

function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function assertNonEmptyString(value, code) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
}

function normalizeStageResult(stage, result) {
  const passed = result === true || result?.passed === true || result?.status === STATUS_PASS;
  return Object.freeze({
    stage,
    status: passed ? STATUS_PASS : STATUS_FAIL,
    passed,
    evidence: result?.evidence ?? null,
    reason: passed ? null : (result?.reason ?? result?.error ?? `stage_failed:${stage}`),
    metrics: result?.metrics ?? null
  });
}

async function runStage(stage, runner, context) {
  const result = await runner(context);
  return normalizeStageResult(stage, result);
}

async function certifyCapability({
  capability,
  version = VERSION,
  runners = {},
  context = {},
  regressionBaseline = null,
  requireAllStages = true
} = {}) {
  assertNonEmptyString(capability, 'evaluation_capability_required');
  const stages = {};
  for (const stage of REQUIRED_STAGES) {
    const runner = runners[stage];
    if (typeof runner !== 'function') {
      stages[stage] = normalizeStageResult(stage, { passed: false, reason: `runner_missing:${stage}` });
      if (requireAllStages) break;
      continue;
    }
    if (stage === 'regression' && regressionBaseline && typeof runners.regression !== 'function') {
      stages[stage] = normalizeStageResult(stage, compareBenchmarks(regressionBaseline, context.currentBenchmark));
      continue;
    }
    stages[stage] = await runStage(stage, runner, context);
    if (requireAllStages && !stages[stage].passed) break;
  }
  for (const stage of REQUIRED_STAGES) {
    if (!stages[stage]) stages[stage] = normalizeStageResult(stage, { passed: false, reason: `stage_not_run:${stage}` });
  }
  const passed = REQUIRED_STAGES.every(stage => stages[stage].passed);
  const evidence = REQUIRED_STAGES.map(stage => stages[stage].evidence).filter(Boolean);
  const certificationId = `eval_${sha256({ capability, version, stages: REQUIRED_STAGES.map(s => stages[s].status) }).slice(0, 32)}`;
  return Object.freeze({
    version,
    capability,
    status: passed ? STATUS_PASS : STATUS_FAIL,
    passed,
    certification_id: certificationId,
    required_stages: REQUIRED_STAGES,
    stages,
    evidence,
    failed_stages: REQUIRED_STAGES.filter(stage => !stages[stage].passed),
    result_hash: sha256({ capability, version, stages, evidence })
  });
}

function normalizeBenchmarkCase(testCase) {
  if (!testCase || typeof testCase !== 'object') throw new Error('benchmark_case_required');
  assertNonEmptyString(testCase.id, 'benchmark_case_id_required');
  if (typeof testCase.run !== 'function') throw new Error(`benchmark_runner_required:${testCase.id}`);
  return testCase;
}

async function runBenchmark({ cases = [], context = {}, failFast = false } = {}) {
  const normalized = cases.map(normalizeBenchmarkCase);
  const results = [];
  for (const testCase of normalized) {
    try {
      const output = await testCase.run(context);
      const passed = typeof testCase.expect === 'function' ? await testCase.expect(output, context) : true;
      results.push(Object.freeze({ id: testCase.id, status: passed ? STATUS_PASS : STATUS_FAIL, output: passed ? output : undefined }));
      if (!passed && failFast) break;
    } catch (error) {
      results.push(Object.freeze({ id: testCase.id, status: STATUS_FAIL, reason: error instanceof Error ? error.message : String(error) }));
      if (failFast) break;
    }
  }
  const passed = results.filter(x => x.status === STATUS_PASS).length;
  const failed = results.length - passed;
  return Object.freeze({
    version: VERSION,
    status: failed === 0 && results.length === normalized.length ? STATUS_PASS : STATUS_FAIL,
    total: normalized.length,
    passed,
    failed,
    results,
    benchmark_hash: sha256(results.map(x => ({ id: x.id, status: x.status })))
  });
}

function compareBenchmarks(baseline, current) {
  const base = new Map((baseline?.results || []).map(r => [r.id, r]));
  const now = new Map((current?.results || []).map(r => [r.id, r]));
  const regressions = [];
  for (const [id, before] of base) {
    const after = now.get(id);
    if (after && before.status === STATUS_PASS && after.status !== STATUS_PASS) regressions.push(id);
  }
  return Object.freeze({ regression_free: regressions.length === 0, regressions });
}

function reliabilityScore(stats = {}) {
  const denominator = Number(stats.missions ?? 0);
  if (!Number.isFinite(denominator) || denominator <= 0) return Object.freeze({ score: null, state: 'unknown' });
  const successRate = Number(stats.success_rate ?? ((stats.successes ?? 0) / denominator));
  const verificationRate = Number(stats.verification_rate ?? ((stats.verified ?? 0) / denominator));
  const recoveryRate = Number(stats.recovery_rate ?? ((stats.recovered ?? 0) / denominator));
  const regressionRate = Number(stats.regression_rate ?? ((stats.regressions ?? 0) / denominator));
  const averageAttempts = Number(stats.average_attempts ?? 1);
  const attemptFactor = Math.max(0, Math.min(1, 1 / Math.max(1, averageAttempts)));
  const score = Math.max(0, Math.min(1,
    (successRate * 0.35) +
    (verificationRate * 0.25) +
    (recoveryRate * 0.15) +
    ((1 - regressionRate) * 0.15) +
    (attemptFactor * 0.10)
  ));
  return Object.freeze({
    score,
    state: 'verified',
    success_rate: successRate,
    verification_rate: verificationRate,
    recovery_rate: recoveryRate,
    regression_rate: regressionRate,
    average_attempts: averageAttempts,
    failure_modes: Object.freeze({ ...(stats.failure_modes || {}) }),
    missions: denominator
  });
}

function aggregateMissionTelemetry(missions = [], capability) {
  assertNonEmptyString(capability, 'reliability_capability_required');
  const relevant = missions.filter(m => !m.capability || m.capability === capability);
  const missionsCount = relevant.length;
  const successes = relevant.filter(m => m.status === 'succeeded' || m.success === true).length;
  const verified = relevant.filter(m => m.verified === true || m.verification_status === 'passed').length;
  const recovered = relevant.filter(m => m.recovered === true || Number(m.recovery_count || 0) > 0).length;
  const regressions = relevant.filter(m => m.regression === true || m.regression_status === 'failed').length;
  const attempts = relevant.map(m => Number(m.attempts)).filter(Number.isFinite);
  const failureModes = {};
  for (const mission of relevant) {
    const mode = mission.failure_mode || mission.error_code || mission.reason;
    if (mode) failureModes[mode] = (failureModes[mode] || 0) + 1;
  }
  const stats = {
    missions: missionsCount,
    successes,
    verified,
    recovered,
    regressions,
    average_attempts: attempts.length ? attempts.reduce((a, b) => a + b, 0) / attempts.length : 1,
    failure_modes: failureModes
  };
  return Object.freeze({ telemetry: Object.freeze(stats), reliability: reliabilityScore(stats) });
}

function longitudinalTest({ missions = [], capability, window = 100, assertion = null } = {}) {
  const relevant = missions.filter(m => !m.capability || m.capability === capability);
  const observed = relevant.slice(-window);
  const required = Math.min(window, 100);
  const sufficient = observed.length >= required;
  const aggregate = aggregateMissionTelemetry(observed, capability);
  const passed = sufficient && (typeof assertion === 'function' ? assertion(aggregate, observed) === true : aggregate.reliability.state === 'verified');
  return Object.freeze({
    capability,
    window,
    required_missions: required,
    observed_missions: observed.length,
    sufficient,
    passed,
    status: passed ? STATUS_PASS : STATUS_FAIL,
    reliability: aggregate.reliability,
    telemetry: aggregate.telemetry,
    reason: sufficient ? null : `longitudinal_missions_required:${required}`,
    longitudinal_hash: sha256(observed.map(m => ({ id: m.id, status: m.status, verified: m.verified, attempts: m.attempts, regression: m.regression })))
  });
}

function buildCapabilityEvaluation({ capability, certification, longitudinal = null, benchmark = null } = {}) {
  assertNonEmptyString(capability, 'capability_evaluation_required');
  const passed = certification?.passed === true && (!longitudinal || longitudinal.passed === true) && (!benchmark || benchmark.status === STATUS_PASS);
  return Object.freeze({
    version: VERSION,
    capability,
    status: passed ? STATUS_PASS : STATUS_FAIL,
    certified: certification?.passed === true,
    longitudinal_passed: longitudinal ? longitudinal.passed === true : null,
    benchmark_passed: benchmark ? benchmark.status === STATUS_PASS : null,
    reliability: longitudinal?.reliability || null,
    certification_id: certification?.certification_id || null
  });
}

module.exports = Object.freeze({
  VERSION,
  REQUIRED_STAGES,
  certifyCapability,
  runBenchmark,
  compareBenchmarks,
  reliabilityScore,
  aggregateMissionTelemetry,
  longitudinalTest,
  buildCapabilityEvaluation,
  canonical,
  sha256
});
