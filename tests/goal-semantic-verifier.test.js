const assert = require("node:assert/strict");
const test = require("node:test");
const { verifyGoal } = require("../autonomy/goal-semantic-verifier-v1.js");

test("rejects a Windows shell success when required evidence is missing", () => {
  const step = {
    operation: "shell.execute",
    executor_type: "device",
    input: { command: "Write-Output ARIA_MEDITATION_WINDOWS_OK" },
    verify: { expected_exit_code: 0, stdout_contains: "ARIA_MEDITATION_WINDOWS_OK" },
  };
  const result = { status: "succeeded", exit_code: 0, stdout: "OTHER_RESULT\r\n" };
  const verdict = verifyGoal("Use Windows Local Agent to verify the physical shell.execute goal", step, result);
  assert.equal(verdict.verified, false);
  assert.equal(verdict.reason, "goal_evidence_token_missing");
});

test("accepts a Windows shell success only with matching evidence", () => {
  const step = {
    operation: "shell.execute",
    executor_type: "device",
    input: { command: "Write-Output ARIA_MEDITATION_WINDOWS_OK" },
    verify: { expected_exit_code: 0, stdout_contains: "ARIA_MEDITATION_WINDOWS_OK" },
  };
  const result = { status: "succeeded", exit_code: 0, stdout: "ARIA_MEDITATION_WINDOWS_OK\r\n" };
  const verdict = verifyGoal("Use Windows Local Agent to verify the physical shell.execute goal", step, result);
  assert.equal(verdict.verified, true);
  assert.equal(verdict.reason, "windows_shell_goal_verified");
});

test("rejects generic success without an explicit verifier", () => {
  const step = { operation: "file_read", executor_type: "connector", target: { connector_id: "github" }, verify: {} };
  const result = { status: "succeeded", data: { ok: true } };
  const verdict = verifyGoal("Verify that the requested repository audit is complete", step, result);
  assert.equal(verdict.verified, false);
  assert.equal(verdict.reason, "explicit_goal_verifier_required");
});

test("preserves explicit generic verification contracts", () => {
  const step = {
    operation: "file_read",
    executor_type: "connector",
    target: { connector_id: "github" },
    verify: { response_content_contains: "README" },
  };
  const result = { status: "succeeded", response: { content: "README content" } };
  const verdict = verifyGoal("Read the repository README and verify the expected content", step, result);
  assert.equal(verdict.verified, true);
  assert.equal(verdict.reason, "explicit_step_verifier_satisfied");
});
