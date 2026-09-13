"use strict";

/**
 * Goal Semantic Verifier v1
 *
 * Never promotes a mission to semantic success merely because a step returned
 * exit_code=0/status=succeeded. The verifier requires the observed evidence to
 * satisfy the intent encoded by the mission goal and the explicit step verifier.
 */

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function containsAny(haystack, needles) {
  const value = normalize(haystack);
  return needles.some((needle) => value.includes(normalize(needle)));
}

function hasStepEvidence(step, result) {
  if (!(result?.status === "succeeded" || result?.ok === true)) return false;
  const verify = step?.verify && typeof step.verify === "object" ? step.verify : {};

  if (verify.expected_exit_code !== undefined && Number(result.exit_code) !== Number(verify.expected_exit_code)) return false;
  if (typeof verify.stdout_contains === "string" && !String(result.stdout ?? "").includes(verify.stdout_contains)) return false;
  if (typeof verify.stderr_contains === "string" && !String(result.stderr ?? "").includes(verify.stderr_contains)) return false;
  if (typeof verify.response_content_equals === "string") {
    const value = String(result?.response?.content ?? result?.response?.output_text ?? "");
    if (value !== verify.response_content_equals) return false;
  }
  if (typeof verify.response_content_contains === "string") {
    const value = String(result?.response?.content ?? result?.response?.output_text ?? "");
    if (!value.includes(verify.response_content_contains)) return false;
  }
  return true;
}

function verifyShellGoal(goal, step, result) {
  const command = text(step?.input?.command);
  const stdout = text(result?.stdout);
  const normalizedGoal = normalize(goal);

  if (!containsAny(normalizedGoal, ["shell.execute", "windows local agent", "windows", "physical e2e"])) {
    return { applicable: false };
  }

  if (!command) {
    return { applicable: true, verified: false, reason: "shell_command_missing" };
  }

  const explicitToken = command.match(/ARIA_[A-Z0-9_]+/g)?.[0] ?? "";
  if (explicitToken && !stdout.includes(explicitToken)) {
    return { applicable: true, verified: false, reason: "goal_evidence_token_missing", expected: explicitToken };
  }

  if (!hasStepEvidence(step, result)) {
    return { applicable: true, verified: false, reason: "step_evidence_failed" };
  }

  return {
    applicable: true,
    verified: true,
    reason: "windows_shell_goal_verified",
    evidence: {
      operation: step.operation,
      executor_type: step.executor_type,
      exit_code: Number(result.exit_code),
      stdout_contains: explicitToken || null,
    },
  };
}

function verifyGenericGoal(goal, step, result) {
  if (!hasStepEvidence(step, result)) {
    return { verified: false, reason: "step_evidence_failed" };
  }

  const goalText = normalize(goal);
  const operation = normalize(step?.operation);
  if (!goalText || !operation) {
    return { verified: false, reason: "goal_or_operation_missing" };
  }

  // Generic safety rule: a successful technical operation is not sufficient
  // semantic evidence unless the step has an explicit verifier constraint.
  const verify = step?.verify && typeof step.verify === "object" ? step.verify : {};
  const hasExplicitConstraint = Object.keys(verify).length > 0;
  if (!hasExplicitConstraint) {
    return { verified: false, reason: "explicit_goal_verifier_required" };
  }

  return {
    verified: true,
    reason: "explicit_step_verifier_satisfied",
    evidence: { operation, executor_type: step.executor_type || step.target?.type || null },
  };
}

function verifyGoal(goal, step, result) {
  const shell = verifyShellGoal(goal, step, result);
  if (shell.applicable) return shell;
  return verifyGenericGoal(goal, step, result);
}

module.exports = {
  verifyGoal,
  hasStepEvidence,
};
