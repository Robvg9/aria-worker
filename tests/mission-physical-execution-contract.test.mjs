import assert from "node:assert/strict";
import fs from "node:fs";
import { explicitPhysicalExecutionRequirement, validatePhysicalExecutionPlan, validatePhysicalExecutionEvidence } from "../supabase/functions/_shared/physical-execution-contract.mjs";

const modelOnlyMission = {
  goal: "Cloud-only: reply with exactly PONG using text generation. No devices.",
  metadata: {},
};
assert.equal(explicitPhysicalExecutionRequirement(modelOnlyMission).required, false, "cloud-only text work must remain eligible for model execution");
const modelOnlyWithContextDevice = { goal: "Summarize this API issue", metadata: { device_id: "windows-lacueva-780886" } };
assert.equal(validatePhysicalExecutionPlan(modelOnlyWithContextDevice, [{
  id: "cloud_review",
  operation: "text_generation",
  executor_type: "model",
  target: { type: "model", provider_id: "google", account_id: "acct_google_gemini_free", model_id: "google/gemini-3.5-flash-lite-direct" },
  verify: { response_content_nonempty: true },
}]).required, false, "a contextual device id must not turn an ordinary model-only mission into a physical-device mission");
const nestedTargetMission = { goal: "Inspect this target", metadata: { request_id: "test", mission_planner_contract: { requested_device_id: "windows-lacueva-780886", requested_capability: "computer.use" } } };
assert.equal(explicitPhysicalExecutionRequirement(nestedTargetMission).required, true, "a nested structured device target must force physical execution");
assert.equal(explicitPhysicalExecutionRequirement(nestedTargetMission).targetDeviceId, "windows-lacueva-780886", "nested structured device target must be read by the runner");
const targetOnlyMission = { goal: "Inspect this target", metadata: { requested_device_id: "windows-lacueva-780886" } };
assert.equal(validatePhysicalExecutionPlan(targetOnlyMission, [{ id: "device", operation: "computer.use", executor_type: "device", target: { type: "device", device_id: "windows-lacueva-780886" } }]).reason, "structured_device_capability_missing", "physical target must declare the capability to be run");

const persistedHumanGateMission = { goal: "Safe autonomy no gate", metadata: { goal_source: "human_gate_e2e", device_id: "windows-lacueva-780886" } };
const persistedHumanGatePlan = [
  { id: "safe_c1", operation: "health", executor_type: "connector", target: { type: "connector", connector_id: "supabase" }, risk: "READ", input: {}, verify: {} },
  { id: "safe_d1", operation: "shell.execute", executor_type: "device", target: { type: "device", device_id: "windows-lacueva-780886" }, risk: "READ", input: { command: "Write-Output SAFE_AUTONOMY_OK", cwd: "D:\\ARIA-Windows-Agent" }, policy: { runtime_probe: true }, verify: { stdout_contains: "SAFE_AUTONOMY_OK" }, depends_on: ["safe_c1"] },
];
const persistedHumanGateValidation = validatePhysicalExecutionPlan(persistedHumanGateMission, persistedHumanGatePlan);
assert.equal(persistedHumanGateValidation.ok, true, "a persisted explicit device plan must remain valid for legacy Human Gate missions without request-level capability fields");
assert.equal(persistedHumanGateValidation.requirement.contract_source, "persisted_explicit_device_plan");
const persistedHumanGateResult = { status: "succeeded", executor_type: "device", operation: "shell.execute", job_id: "uo_safe_d1_a1", exit_code: 0, stdout: "SAFE_AUTONOMY_OK", stderr: "" };
assert.equal(validatePhysicalExecutionEvidence(persistedHumanGateMission, persistedHumanGatePlan, { safe_d1: persistedHumanGateResult }, () => true).ok, true, "plan-derived shell contracts must still require a real successful device result");

for (const operation of ["shell.execute", "computer.use", "computer.use.autonomous", "computer.use.android", "android.notification", "ollama.qwen3", "ecc.execute"]) {
  const detected = explicitPhysicalExecutionRequirement({ goal: "Execute one authorized operation", metadata: { requested_capability: operation, requested_device_id: "windows-lacueva-780886" } });
  assert.equal(detected.required, true, operation + " must require physical execution evidence");
  assert.equal(detected.operation, operation, operation + " identity must be preserved");
}


const historicalFalsePositive = {
  goal: "Run shell.execute on device_id=windows-lacueva-780886; execute PowerShell and SSH; report ARIA_SSH_QUEUE_E2E_OK",
  metadata: {},
};
const historicalPlan = [{
  id: "step_model",
  operation: "text_generation",
  executor_type: "model",
  target: { type: "model", provider_id: "provider", account_id: "account", model_id: "model" },
  verify: { response_content_nonempty: true },
}];
assert.equal(explicitPhysicalExecutionRequirement(historicalFalsePositive).required, true);
assert.equal(validatePhysicalExecutionPlan(historicalFalsePositive, historicalPlan).ok, false, "physical intent without structured device contract must fail closed");

const marker = "ARIA_SSH_QUEUE_E2E_OK";
const command = "powershell -NoProfile -Command Write-Output ARIA_SSH_QUEUE_E2E_OK";
const validMission = {
  goal: "Run shell.execute against device_id=windows-lacueva-780886 and verify ARIA_SSH_QUEUE_E2E_OK",
  metadata: {
    requested_capability: "shell.execute",
    requested_device_id: "windows-lacueva-780886",
    command,
    verification_marker: marker,
  },
};
const validStep = {
  id: "device_shell",
  operation: "shell.execute",
  executor_type: "device",
  target: { type: "device", device_id: "windows-lacueva-780886" },
  input: { command },
  verify: { expected_exit_code: 0, stdout_contains: marker },
};
assert.equal(validatePhysicalExecutionPlan(validMission, [validStep]).ok, true, "proper structured physical contract should pass preflight");
assert.equal(validatePhysicalExecutionPlan(validMission, [{ ...validStep, target: { type: "device", device_id: "windows-other-000001" } }]).ok, false, "wrong device must not satisfy target identity");

const goodResult = { status: "succeeded", executor_type: "device", operation: "shell.execute", job_id: "uo_test_device_shell_a1", exit_code: 0, stdout: marker, stderr: "" };
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: goodResult }, () => true).ok, true, "physical success requires status, exit code, marker, and step verifier");
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: { ...goodResult, exit_code: 1 } }, () => true).ok, false, "non-zero exit code must fail");
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: { ...goodResult, exit_code: null } }, () => true).ok, false, "missing exit code must not be coerced to zero");
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: { ...goodResult, stdout: "different output" } }, () => true).ok, false, "missing stdout marker must fail");
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: { ...goodResult, job_id: "" } }, () => true).ok, false, "missing execution-job identity must fail");
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: { ...goodResult, executor_type: "model" } }, () => true).ok, false, "model result must not satisfy a physical-device step");
const computerUseMission = { goal: "Use computer.use on device_id=windows-lacueva-780886 and verify the UI result", metadata: { requested_capability: "computer.use", requested_device_id: "windows-lacueva-780886" } };
const computerUseStep = { id: "device_ui", operation: "computer.use", executor_type: "device", target: { type: "device", device_id: "windows-lacueva-780886" }, verify: { status_succeeded: true } };
assert.equal(validatePhysicalExecutionEvidence(computerUseMission, [computerUseStep], { device_ui: { status: "succeeded", executor_type: "device", operation: "computer.use", job_id: "", stdout: "looks okay" } }, () => true).ok, false, "computer.use must also require an execution-job ID");
const androidComputerUseMission = { goal: "Use computer.use on device_id=android-termux-a1 and verify result", metadata: { requested_capability: "computer.use", requested_device_id: "android-termux-a1" } };
const androidComputerUseStep = { id: "android_ui", operation: "computer.use", executor_type: "device", target: { type: "device", device_id: "android-termux-a1" }, verify: { status_succeeded: true } };
assert.equal(validatePhysicalExecutionEvidence(androidComputerUseMission, [androidComputerUseStep], { android_ui: { status: "succeeded", executor_type: "device", operation: "computer.use.android", job_id: "uo_android_ui_a1", result: { status: "succeeded" } } }, () => true).ok, true, "the explicit Android device may report its canonical computer.use.android alias");
const windowsAliasMission = { goal: "Use computer.use on device_id=windows-lacueva-780886", metadata: { requested_capability: "computer.use", requested_device_id: "windows-lacueva-780886" } };
const windowsAliasStep = { ...computerUseStep, target: { type: "device", device_id: "windows-lacueva-780886" } };
assert.equal(validatePhysicalExecutionEvidence(windowsAliasMission, [windowsAliasStep], { device_ui: { status: "succeeded", executor_type: "device", operation: "computer.use.android", job_id: "uo_wrong_alias_a1", result: { status: "succeeded" } } }, () => true).ok, false, "the Android executor alias must not satisfy a Windows request");
assert.equal(validatePhysicalExecutionEvidence(validMission, [validStep], { device_shell: { ...goodResult, __aria_verified_by_runner: true } }, () => true).ok, true, "verified result is accepted only with the explicit device result, job id, exit code, and marker");

const planner = fs.readFileSync(new URL("../supabase/functions/aria-planner-v11/index.ts", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../supabase/functions/aria-mission-runner-v22/index.ts", import.meta.url), "utf8");
assert.match(planner, /validatePhysicalExecutionPlan\(\{goal,metadata:context\?\.mission_planner_contract\},directDevice\.steps\)/);
assert.match(planner, /explicit_physical_execution_contract_incomplete/);
assert.match(planner, /physical_contract_validated:true/);
assert.ok(planner.includes("directDeviceIntentPlan(goal,{...context,mission_planner_contract:earlyPhysicalMetadata})"), "early physical routing must normalize nested mission_planner_contract before plan creation");
assert.ok(planner.includes('"android.notification", "ollama.qwen3", "ecc.execute"'), "planner explicit capability allowlist must include the non-shell physical operations");
const plannerEntry = planner.indexOf("Deno.serve(async r=>");
const earlyPhysicalGate = planner.indexOf("const earlyPhysicalRequirement=explicitPhysicalExecutionRequirement", plannerEntry);
const firstGenericPlannerRoute = planner.indexOf("const cuevacoinStep6=cuevacoinStep6Plan(goal)", plannerEntry);
assert.ok(plannerEntry >= 0 && earlyPhysicalGate > plannerEntry && earlyPhysicalGate < firstGenericPlannerRoute, "physical-intent rejection/route selection must happen before any generic planner fast path");
assert.match(runner, /validatePhysicalExecutionPlan\(mission, normalizedSteps\)/);
assert.match(runner, /validatePhysicalExecutionEvidence\(mission, steps, results, verifyStep\)/);
assert.match(runner, /from\("execution_jobs"\)/);
assert.match(runner, /physical_execution_job_not_persisted/);
assert.match(runner, /physical_execution_job_device_mismatch/);
assert.match(runner, /physical_execution_job_verification_mismatch/);
const normalizedAt = runner.indexOf("const normalizedSteps = steps.map((step: any) => normalizeExecutionStep(step, mission));");
const planGateAt = runner.indexOf("validatePhysicalExecutionPlan(mission, normalizedSteps)");
const executorSelectedAt = runner.indexOf('await emitEvent(missionId, "executor_selected"');
const terminalGateAt = runner.indexOf("validatePhysicalExecutionEvidence(mission, steps, results, verifyStep)");
const missionVerifiedAt = runner.indexOf('await emitEvent(missionId, "mission_verified"');
assert.ok(normalizedAt >= 0 && planGateAt > normalizedAt && planGateAt < executorSelectedAt, "physical plan gate must run after normalization and before executor selection");
assert.ok(terminalGateAt >= 0 && terminalGateAt < missionVerifiedAt, "physical evidence gate must precede mission_verified");
console.log("PHYSICAL EXECUTION FAIL-CLOSED CONTRACT: PASS");
