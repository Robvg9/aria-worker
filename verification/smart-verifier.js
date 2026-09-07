'use strict';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'blocked']);
const EXECUTOR_TYPES = new Set(['connector', 'device', 'model', 'agent']);

function check(condition, code, detail = null) {
  return { code, passed: Boolean(condition), detail };
}

function verifyStructural(plan = {}, result = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const checks = [
    check(steps.length > 0, 'steps_present'),
    check(steps.every((s) => s && typeof s.id === 'string' && s.id.length > 0), 'step_ids_valid'),
    check(steps.every((s) => EXECUTOR_TYPES.has(String(s.executor_type || s.target?.type || ''))), 'executor_types_valid'),
    check(steps.every((s) => typeof s.operation === 'string' && s.operation.length > 0), 'operations_present'),
    check(result == null || typeof result === 'object', 'result_shape_valid'),
  ];
  return { name: 'structural', passed: checks.every((c) => c.passed), checks };
}

function verifySemantic(step = {}, result = {}) {
  const v = step.verify && typeof step.verify === 'object' ? step.verify : {};
  const content = String(result?.response?.content ?? result?.response?.output_text ?? '');
  const checks = [];
  if (v.response_content_equals !== undefined) checks.push(check(content === String(v.response_content_equals), 'response_content_equals'));
  if (v.response_content_contains !== undefined) checks.push(check(content.includes(String(v.response_content_contains)), 'response_content_contains'));
  if (v.stdout_contains !== undefined) checks.push(check(String(result?.stdout ?? '').includes(String(v.stdout_contains)), 'stdout_contains'));
  if (v.stderr_contains !== undefined) checks.push(check(String(result?.stderr ?? '').includes(String(v.stderr_contains)), 'stderr_contains'));
  if (v.expected_exit_code !== undefined) checks.push(check(Number(result?.exit_code) === Number(v.expected_exit_code), 'expected_exit_code'));
  if (checks.length === 0) checks.push(check(result?.status === 'succeeded' || result?.ok === true, 'status_success'));
  return { name: 'semantic', passed: checks.every((c) => c.passed), checks };
}

function verifyProvider(step = {}, result = {}) {
  if (String(step.executor_type || step.target?.type) !== 'model') {
    return { name: 'provider', passed: true, checks: [check(true, 'not_applicable')] };
  }
  const target = step.target || {};
  const checks = [
    check(Boolean(target.provider_id), 'provider_id_present'),
    check(Boolean(target.account_id), 'account_id_present'),
    check(Boolean(target.model_id), 'model_id_present'),
    check(Boolean(result?.provider_id ?? result?.metadata?.provider_id ?? target.provider_id), 'provider_execution_identity_present'),
  ];
  return { name: 'provider', passed: checks.every((c) => c.passed), checks };
}

function verifySecurity(step = {}, result = {}) {
  const auth = step.authorization && typeof step.authorization === 'object' ? step.authorization : {};
  const serialized = JSON.stringify({ step, result });
  const forbidden = /(api[_-]?key|bearer\s+[A-Za-z0-9._-]{12,}|secret|password)\s*[:=]/i;
  const checks = [
    check(auth.status === 'approved' || auth.status === 'verified' || auth.status === undefined, 'authorization_state_valid'),
    check(!forbidden.test(serialized), 'secret_material_not_exposed'),
  ];
  return { name: 'security', passed: checks.every((c) => c.passed), checks };
}

function verifyMission({ goal = '', plan = {}, step = {}, result = {}, context = {} } = {}) {
  const terminal = TERMINAL.has(String(result?.status));
  const structural = verifyStructural(plan, result);
  const semantic = verifySemantic(step, result);
  const provider = verifyProvider(step, result);
  const security = verifySecurity(step, result);
  const goalText = String(goal).trim();
  const expected = step?.verify?.response_content_equals;
  const goalCheck = expected === undefined
    ? check(Boolean(goalText), 'goal_present')
    : check(String(result?.response?.content ?? result?.response?.output_text ?? '') === String(expected), 'goal_semantic_contract');
  const groups = [structural, semantic, provider, security, { name: 'goal', passed: goalCheck.passed, checks: [goalCheck] }];
  const passed = terminal && groups.every((g) => g.passed);
  const failed_checks = groups.flatMap((g) => g.checks.filter((c) => !c.passed).map((c) => `${g.name}:${c.code}`));
  return Object.freeze({ version: 'smart-verifier-v1', passed, terminal, groups, failed_checks, evidence: { goal: goalText || null, context_keys: Object.keys(context || {}).slice(0, 32) } });
}

module.exports = Object.freeze({ verifyStructural, verifySemantic, verifyProvider, verifySecurity, verifyMission });
