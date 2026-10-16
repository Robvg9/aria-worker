const PHYSICAL_EXECUTION_CAPABILITIES = new Set([
  "shell.execute",
  "computer.use",
  "computer.use.autonomous",
  "computer.use.android",
  "android.notification",
  "ollama.qwen3",
  "ecc.execute",
]);

function physicalClean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function physicalMetadata(mission) {
  const metadata = mission?.metadata && typeof mission.metadata === "object" && !Array.isArray(mission.metadata)
    ? mission.metadata
    : {};
  const nested = metadata.mission_planner_contract && typeof metadata.mission_planner_contract === "object" && !Array.isArray(metadata.mission_planner_contract)
    ? metadata.mission_planner_contract
    : null;
  if (nested) return { ...metadata, ...nested };
  if (mission?.mission_planner_contract && typeof mission.mission_planner_contract === "object" && !Array.isArray(mission.mission_planner_contract)) {
    return { ...metadata, ...mission.mission_planner_contract };
  }
  return metadata;
}

function targetHintFromGoal(goal) {
  const keyed = goal.match(/\b(?:requested[\s_-]*)?device[\s_-]*id\s*[:=]\s*["']?([a-z0-9][a-z0-9_-]{4,})/i);
  if (keyed?.[1]) return keyed[1];
  return goal.match(/\bwindows-[a-z0-9][a-z0-9_-]{5,}\b/i)?.[0] || "";
}

function goalMarker(goal) {
  return goal.match(/\bARIA_[A-Z0-9_]*E2E[A-Z0-9_]*\b/i)?.[0] || "";
}

/**
 * Detects missions whose success must be backed by a physical-device execution.
 * Text-only analysis remains eligible for model execution; explicit device intent
 * cannot silently fall back to a model-only plan.
 */
export function explicitPhysicalExecutionRequirement(mission = {}) {
  const metadata = physicalMetadata(mission);
  const goal = String(mission?.goal || "");
  const metadataCapability = physicalClean(metadata.requested_capability || metadata.capability).toLowerCase();
  const goalCapability = (goal.match(/\b(shell\.execute|computer\.use(?:\.autonomous|\.android)?)\b/i)?.[1] || "").toLowerCase();
  const structuredDeviceId = physicalClean(metadata.requested_device_id || metadata.device_id);
  const goalDeviceId = targetHintFromGoal(goal);
  const shellCue = /\b(?:powershell|test-netconnection|ssh(?:\.exe)?|exit[_ -]?code|execution[_ -]?job|stdout|ARIA_[A-Z0-9_]*E2E[A-Z0-9_]*)\b/i.test(goal);
  const operation = PHYSICAL_EXECUTION_CAPABILITIES.has(metadataCapability)
    ? metadataCapability
    : (goalCapability || ((structuredDeviceId || goalDeviceId) && shellCue ? "shell.execute" : ""));
  const required = PHYSICAL_EXECUTION_CAPABILITIES.has(metadataCapability)
    || Boolean(structuredDeviceId)
    || Boolean(goalDeviceId && (goalCapability || shellCue));
  return {
    required,
    operation,
    structuredDeviceId,
    goalDeviceId,
    targetDeviceId: structuredDeviceId || goalDeviceId,
    structuredCommand: physicalClean(metadata.command),
    structuredVerificationMarker: physicalClean(metadata.verification_marker),
    verificationMarker: physicalClean(metadata.verification_marker) || goalMarker(goal),
  };
}

function deviceOperation(step) {
  return physicalClean(step?.operation).toLowerCase();
}

function isDeviceStep(step) {
  const executor = physicalClean(step?.executor_type || step?.target?.type).toLowerCase();
  return executor === "device" && PHYSICAL_EXECUTION_CAPABILITIES.has(deviceOperation(step));
}

export function validatePhysicalExecutionPlan(mission, steps) {
  const requirement = explicitPhysicalExecutionRequirement(mission);
  if (!requirement.required) return { ok: true, required: false, reason: "not_a_physical_execution_mission" };
  if (!requirement.operation) return { ok: false, required: true, reason: "structured_device_capability_missing", requirement };

  if (requirement.operation === "shell.execute") {
    if (!requirement.structuredDeviceId) return { ok: false, required: true, reason: "structured_device_id_missing", requirement };
    if (!requirement.structuredCommand) return { ok: false, required: true, reason: "structured_shell_command_missing", requirement };
    if (!requirement.structuredVerificationMarker) return { ok: false, required: true, reason: "structured_verification_marker_missing", requirement };
  }
  if (requirement.goalDeviceId && !requirement.structuredDeviceId) {
    return { ok: false, required: true, reason: "structured_device_id_missing", requirement };
  }
  if (requirement.goalDeviceId && requirement.structuredDeviceId && requirement.goalDeviceId !== requirement.structuredDeviceId) {
    return { ok: false, required: true, reason: "structured_device_id_conflicts_with_goal", requirement };
  }

  const deviceSteps = (Array.isArray(steps) ? steps : []).filter(isDeviceStep);
  if (!deviceSteps.length) return { ok: false, required: true, reason: "physical_device_step_missing", requirement };

  const matchingStep = deviceSteps.find((step) => {
    if (requirement.operation && deviceOperation(step) !== requirement.operation) return false;
    const deviceId = physicalClean(step?.target?.device_id || step?.input?.device_id);
    if (!deviceId) return false;
    return !requirement.targetDeviceId || deviceId === requirement.targetDeviceId;
  });
  if (!matchingStep) return { ok: false, required: true, reason: "physical_device_target_mismatch", requirement };

  if (requirement.operation === "shell.execute") {
    const command = physicalClean(matchingStep?.input?.command);
    const expectedExitCode = matchingStep?.verify?.expected_exit_code;
    const marker = physicalClean(matchingStep?.verify?.stdout_contains);
    if (command !== requirement.structuredCommand || expectedExitCode !== 0 || marker !== requirement.structuredVerificationMarker) {
      return { ok: false, required: true, reason: "shell_execution_verification_contract_incomplete", requirement };
    }
  }

  return { ok: true, required: true, reason: "physical_execution_plan_contract_valid", requirement, stepId: String(matchingStep.id || "") };
}

export function validatePhysicalExecutionEvidence(mission, steps, results, verifyStep) {
  const plan = validatePhysicalExecutionPlan(mission, steps);
  if (!plan.ok || !plan.required) return plan;
  const requirement = plan.requirement;
  const step = (Array.isArray(steps) ? steps : []).find((candidate) =>
    isDeviceStep(candidate)
    && (!requirement.operation || deviceOperation(candidate) === requirement.operation)
    && Boolean(physicalClean(candidate?.target?.device_id || candidate?.input?.device_id))
    && (!requirement.targetDeviceId || physicalClean(candidate?.target?.device_id || candidate?.input?.device_id) === requirement.targetDeviceId)
  );
  if (!step) return { ok: false, required: true, reason: "physical_device_step_missing_at_terminalization", requirement };
  const result = results && typeof results === "object" ? results[String(step.id)] : null;
  if (!result || !(result.status === "succeeded" || result.ok === true) || result.error) {
    return { ok: false, required: true, reason: "physical_execution_result_not_succeeded", requirement, stepId: String(step.id || "") };
  }
  if (result.executor_type !== "device" || deviceOperation({ operation: result.operation }) !== deviceOperation(step)) {
    return { ok: false, required: true, reason: "physical_execution_result_executor_mismatch", requirement, stepId: String(step.id || "") };
  }
  if (typeof verifyStep === "function" && verifyStep(step, result) !== true) {
    return { ok: false, required: true, reason: "physical_execution_step_verification_failed", requirement, stepId: String(step.id || "") };
  }
  if (!physicalClean(result.job_id)) return { ok: false, required: true, reason: "physical_execution_job_id_missing", requirement, stepId: String(step.id || "") };
  if (requirement.operation === "shell.execute") {
    const marker = requirement.structuredVerificationMarker;
    if (!Number.isInteger(result.exit_code) || result.exit_code !== 0) return { ok: false, required: true, reason: "physical_execution_exit_code_not_zero", requirement, stepId: String(step.id || "") };
    if (!marker || typeof result.stdout !== "string" || !result.stdout.includes(marker)) {
      return { ok: false, required: true, reason: "physical_execution_stdout_marker_missing", requirement, stepId: String(step.id || "") };
    }
  }
  return { ok: true, required: true, reason: "physical_execution_evidence_verified", requirement, stepId: String(step.id || "") };
}
