'use strict';

function assertCase(testCase) {
  if (!testCase || typeof testCase.id !== 'string' || !testCase.id) throw new Error('eval_case_id_required');
  if (typeof testCase.run !== 'function') throw new Error(`eval_case_runner_required:${testCase.id}`);
}
async function runEvalCase(testCase, context = {}) {
  assertCase(testCase);
  const started = Date.now();
  try {
    const output = await testCase.run(context);
    const expected = typeof testCase.expect === 'function' ? await testCase.expect(output, context) : true;
    return { id: testCase.id, status: expected ? 'passed' : 'failed', duration_ms: Date.now() - started, output };
  } catch (error) {
    return { id: testCase.id, status: 'error', duration_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}
async function runEvalSuite({ cases = [], context = {}, failFast = false } = {}) {
  const results = [];
  for (const testCase of cases) {
    const result = await runEvalCase(testCase, context);
    results.push(result);
    if (failFast && result.status !== 'passed') break;
  }
  const passed = results.filter(r => r.status === 'passed').length;
  return Object.freeze({ status: passed === cases.length ? 'passed' : 'failed', total: cases.length, passed, failed: results.filter(r => r.status !== 'passed').length, results });
}
function compareSuites(baseline, current) {
  const a = new Map((baseline?.results || []).map(r => [r.id, r]));
  const b = new Map((current?.results || []).map(r => [r.id, r]));
  const regressions = [];
  for (const [id, before] of a) {
    const after = b.get(id);
    if (after && before.status === 'passed' && after.status !== 'passed') regressions.push(id);
  }
  return { regression_free: regressions.length === 0, regressions };
}
module.exports = { runEvalCase, runEvalSuite, compareSuites };
