'use strict';
const assert = require('node:assert/strict');
const {
  VERSION,
  REQUIRED_STAGES,
  certifyCapability,
  runBenchmark,
  compareBenchmarks,
  reliabilityScore,
  aggregateMissionTelemetry,
  longitudinalTest,
  buildCapabilityEvaluation
} = require('../evaluation/engine-v2');

(async () => {
  assert.equal(VERSION, 'evaluation-engine-v2.0.0');
  assert.deepEqual(REQUIRED_STAGES, ['unit','integration','security','behavior','regression','live']);

  const calls = [];
  const certification = await certifyCapability({
    capability: 'text_generation',
    context: { currentBenchmark: { results: [] } },
    runners: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, async () => { calls.push(stage); return { passed: true, evidence: { stage } }; }]))
  });
  assert.equal(certification.passed, true);
  assert.deepEqual(calls, REQUIRED_STAGES);
  assert.equal(certification.failed_stages.length, 0);
  assert.match(certification.certification_id, /^eval_[a-f0-9]{32}$/);

  const failClosed = await certifyCapability({
    capability: 'unsafe_capability',
    runners: {
      unit: async () => ({ passed: true }),
      integration: async () => ({ passed: true }),
      security: async () => ({ passed: false, reason: 'security_violation' })
    }
  });
  assert.equal(failClosed.passed, false);
  assert.equal(failClosed.stages.security.reason, 'security_violation');
  assert.equal(failClosed.stages.behavior.reason, 'stage_not_run:behavior');
  assert.equal(failClosed.stages.live.reason, 'stage_not_run:live');

  const benchmark = await runBenchmark({
    cases: [
      { id:'b1', run: async () => 2, expect: v => v === 2 },
      { id:'b2', run: async () => ({ok:true}), expect: v => v.ok === true },
      { id:'b3', run: async () => 1, expect: v => v === 2 }
    ]
  });
  assert.equal(benchmark.total, 3);
  assert.equal(benchmark.passed, 2);
  assert.equal(benchmark.failed, 1);
  assert.equal(benchmark.status, 'failed');

  assert.deepEqual(compareBenchmarks(
    {results:[{id:'a',status:'passed'},{id:'b',status:'passed'}]},
    {results:[{id:'a',status:'passed'},{id:'b',status:'failed'}]}
  ), {regression_free:false, regressions:['b']});

  const telemetry = aggregateMissionTelemetry([
    {id:'1',capability:'text_generation',status:'succeeded',verified:true,attempts:1},
    {id:'2',capability:'text_generation',status:'succeeded',verified:true,recovered:true,attempts:2},
    {id:'3',capability:'text_generation',status:'failed',verified:false,attempts:3,failure_mode:'timeout',regression:true},
    {id:'4',capability:'other',status:'failed',attempts:8}
  ], 'text_generation');
  assert.equal(telemetry.telemetry.missions, 3);
  assert.equal(telemetry.telemetry.successes, 2);
  assert.equal(telemetry.telemetry.verified, 2);
  assert.equal(telemetry.telemetry.recovered, 1);
  assert.equal(telemetry.telemetry.regressions, 1);
  assert.equal(telemetry.telemetry.failure_modes.timeout, 1);
  assert.equal(telemetry.reliability.state, 'verified');
  assert.ok(telemetry.reliability.score >= 0 && telemetry.reliability.score <= 1);

  assert.deepEqual(reliabilityScore({missions:0}), {score:null,state:'unknown'});

  const missions = Array.from({length:100}, (_,i) => ({
    id:`m${i+1}`, capability:'browser', status:'succeeded', verified:true,
    recovered:i%10===0, attempts:i%7===0 ? 2 : 1
  }));
  const longitudinal = longitudinalTest({
    missions,
    capability:'browser',
    window:100,
    assertion: ({reliability}) => reliability.success_rate === 1 && reliability.verification_rate === 1
  });
  assert.equal(longitudinal.passed, true);
  assert.equal(longitudinal.observed_missions, 100);
  assert.equal(longitudinal.sufficient, true);
  assert.equal(longitudinal.reliability.success_rate, 1);
  assert.equal(longitudinal.reliability.verification_rate, 1);

  const insufficient = longitudinalTest({missions: missions.slice(0,99), capability:'browser', window:100});
  assert.equal(insufficient.passed, false);
  assert.equal(insufficient.sufficient, false);

  const evaluation = buildCapabilityEvaluation({
    capability:'browser',
    certification,
    longitudinal,
    benchmark:{status:'passed'}
  });
  assert.equal(evaluation.status, 'passed');
  assert.equal(evaluation.certified, true);
  assert.equal(evaluation.longitudinal_passed, true);
  assert.equal(evaluation.benchmark_passed, true);

  console.log('EVALUATION ENGINE 2.0: PASS — benchmark stages, fail-closed certification, regression detection, longitudinal testing, reliability metrics and capability evaluation');
})();
