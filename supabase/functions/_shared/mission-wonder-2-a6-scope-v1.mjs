const norm = (value) => typeof value === "string" ? value.trim() : "";
const projectNorm = (value) => value == null || String(value).trim() === "" ? null : String(value).trim();

export const M22_A6_RUN_SCOPE_PREFIX = "mission_wonder_2_a6_run_";
export const M22_A6_SCOPE_PREFIX = "mission_wonder_2_a6_";
export const M22_A6_ALLOWED_DEVICE_ID = "windows-fe722cc6681e4f9c9cc35f5ebbb0a089";
export const M22_A6_WINDOW_HOURS = 24;
export const M22_A6_MISSION_COUNT = 5;
export const M22_A6_MAX_JOBS = 5;
export const M22_A6_MAX_ATTEMPTS = 1;
export const M22_A6_MISSION_OFFSETS_HOURS = Object.freeze([1, 6, 12, 18, 23]);
export const M22_A6_RUN_ID_PATTERN = /^m22-a6-[a-f0-9]{12}$/i;

export function m22A6RunScopeIdV1(runId) {
  const id = norm(runId);
  if (!M22_A6_RUN_ID_PATTERN.test(id)) throw new Error("a6_run_id_invalid");
  return M22_A6_RUN_SCOPE_PREFIX + id;
}

export function m22A6MissionIdV1(runId, ordinal) {
  const id = norm(runId);
  if (!M22_A6_RUN_ID_PATTERN.test(id)) throw new Error("a6_run_id_invalid");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > M22_A6_MISSION_COUNT) {
    throw new Error("a6_mission_ordinal_invalid");
  }
  return "mission_" + id.replace(/-/g, "_") + "_" + String(ordinal).padStart(2, "0");
}

export function m22A6StepIdV1(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > M22_A6_MISSION_COUNT) {
    throw new Error("a6_mission_ordinal_invalid");
  }
  return "a6_continuity_marker_" + String(ordinal).padStart(2, "0");
}

export function m22A6ChildScopeIdV1(runId, ordinal) {
  return M22_A6_SCOPE_PREFIX + norm(runId) + "_" + String(ordinal).padStart(2, "0");
}

export function m22A6GoalV1(runId, ordinal) {
  return "Mission Wonder 2 A6 bounded continuity marker " + norm(runId) +
    " sequence " + String(ordinal).padStart(2, "0");
}

export async function m22A6GoalIdentityHashV1(userId, goal, projectId = null) {
  const payload = JSON.stringify({
    version: 1,
    user_id: norm(userId),
    goal: norm(goal),
    project_id: projectNorm(projectId),
  });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function m22A6ExpectedJobIdV1(missionId, stepId) {
  const safe = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 28);
  // Preserve the canonical runner's literal backslash-zero separator contract.
  const raw = String(missionId) + "\\0" + String(stepId) + "\\0" + "1";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const suffix = Array.from(new Uint8Array(digest)).slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return "uo_" + safe(missionId) + "_" + safe(stepId) + "_a1_" + suffix;
}

export function m22A6ArtifactPathV1(runId, ordinal) {
  const id = norm(runId);
  if (!M22_A6_RUN_ID_PATTERN.test(id)) throw new Error("a6_run_id_invalid");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > M22_A6_MISSION_COUNT) {
    throw new Error("a6_mission_ordinal_invalid");
  }
  return "C:\\Windows\\Temp\\ARIA-MW2-A6\\" + id + "\\mission-" + String(ordinal).padStart(2, "0") + "\\proof-" +
    String(ordinal).padStart(2, "0") + ".txt";
}

export function m22A6BuildContinuityProbeStepV1(deviceId, runId, ordinal, humanGateRef) {
  const device = norm(deviceId);
  const id = norm(runId);
  const gateRef = norm(humanGateRef);
  if (!/^a6-human-gate-[0-9]{10,20}\\.[0-9]{1,3}$/.test(gateRef)) throw new Error("a6_human_gate_ref_invalid");
  if (device !== M22_A6_ALLOWED_DEVICE_ID) throw new Error("a6_device_not_allowlisted");
  const stepId = m22A6StepIdV1(ordinal);
  const artifactPath = m22A6ArtifactPathV1(id, ordinal);
  const directory = "C:\\Windows\\Temp\\ARIA-MW2-A6\\" + id + "\\mission-" + String(ordinal).padStart(2, "0");
  const marker = "ARIA_MW2_A6_CONTINUITY_V1|" + id + "|" + String(ordinal).padStart(2, "0");
  const sequence = String(ordinal).padStart(2, "0");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$directory = '" + directory + "'",
    "$artifact = '" + artifactPath + "'",
    "$marker = '" + marker + "'",
    "[IO.Directory]::CreateDirectory($directory) | Out-Null",
    "$files = @(Get-ChildItem -LiteralPath $directory -File -Force -ErrorAction SilentlyContinue)",
    "if ($files.Count -gt 1) { throw 'A6_ARTIFACT_DUPLICATES_FOUND' }",
    "if ($files.Count -eq 1 -and $files[0].FullName -cne $artifact) { throw 'A6_UNEXPECTED_ARTIFACT_FOUND' }",
    "if ([IO.File]::Exists($artifact)) {",
    "  if ($files.Count -ne 1) { throw 'A6_ARTIFACT_COUNT_MISMATCH' }",
    "  $existing = [IO.File]::ReadAllText($artifact, [Text.Encoding]::ASCII)",
    "  if ($existing -cne $marker) { throw 'A6_ARTIFACT_CONTENT_MISMATCH' }",
    "  $sha = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()",
    "  Write-Output ('A6_ARTIFACT_VERIFIED;mode=identical;sequence=" + sequence + ";sha256=' + $sha + ';artifact=' + $artifact)",
    "  exit 0",
    "}",
    "[IO.File]::WriteAllText($artifact, $marker, [Text.Encoding]::ASCII)",
    "$sha = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()",
    "Write-Output ('A6_ARTIFACT_VERIFIED;mode=created;sequence=" + sequence + ";sha256=' + $sha + ';artifact=' + $artifact)",
  ].join("\n");
  return {
    id: stepId,
    operation: "shell.execute",
    executor_type: "device",
    risk: "WRITE",
    target: { type: "device", device_id: device },
    input: { command: script, cwd: "C:\\Windows\\Temp" },
    policy: {
      read_only: false,
      mission_wonder_2_a6_continuity: true,
      allowed_artifact_path: artifactPath,
      idempotent_artifact: true,
      max_artifacts: 1,
      network_access: false,
      external_mutations: false,
    },
    authorization: {
      status: "approved",
      risk_class: "WRITE",
      evidence_ref: gateRef,
    },
    timeout_ms: 60000,
    retryable: false,
    max_attempts: M22_A6_MAX_ATTEMPTS,
    depends_on: [],
    verify: {
      expected_exit_code: 0,
      stdout_contains: "A6_ARTIFACT_VERIFIED;sequence=" + sequence,
    },
  };
}

export function m22A6ContinuityProbeStepMatchesV1(step, deviceId, runId, ordinal, humanGateRef) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return false;
  try {
    return JSON.stringify(step) === JSON.stringify(m22A6BuildContinuityProbeStepV1(deviceId, runId, ordinal, humanGateRef));
  } catch {
    return false;
  }
}

export async function m22A6ScopeRowMatchesV1({
  run,
  scope,
  metadata,
  missionId,
  userId,
  requestId,
  goal,
  projectId = null,
  requiredStatuses = ["armed", "queued", "claimed", "bound", "running"],
  nowMs = Date.now(),
}) {
  if (!run || typeof run !== "object" || Array.isArray(run) ||
      !scope || typeof scope !== "object" || Array.isArray(scope) ||
      !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const owner = norm(userId);
  const request = norm(requestId);
  const id = norm(missionId);
  const runId = norm(run.run_id);
  const ordinal = Number(scope.ordinal);
  if (!owner || !request || !M22_A6_RUN_ID_PATTERN.test(runId) ||
      id !== m22A6MissionIdV1(runId, ordinal) ||
      !/^a6-human-gate-[0-9]{10,20}\\.[0-9]{1,3}$/.test(norm(run.human_gate_ref)) ||
      projectNorm(projectId) !== null || projectNorm(metadata.project_id) !== null) return false;

  const expectedGoal = m22A6GoalV1(runId, ordinal);
  const expectedHash = await m22A6GoalIdentityHashV1(owner, expectedGoal, null);
  const expectedJobId = await m22A6ExpectedJobIdV1(id, m22A6StepIdV1(ordinal));
  const expectedStep = m22A6BuildContinuityProbeStepV1(M22_A6_ALLOWED_DEVICE_ID, runId, ordinal, run.human_gate_ref);
  const expectedExpiry = Date.parse(String(run.expires_at || ""));
  const scopeExpiry = Date.parse(String(scope.expires_at || ""));
  const startedAt = Date.parse(String(run.started_at || ""));
  const statuses = Array.isArray(requiredStatuses) ? requiredStatuses.map(String) : [];

  return Boolean(
    run.scope_id === m22A6RunScopeIdV1(runId) &&
    run.owner_user_id === owner &&
    run.allowed_device_id === M22_A6_ALLOWED_DEVICE_ID &&
    run.status === "running" &&
    run.window_hours === M22_A6_WINDOW_HOURS &&
    run.max_missions === M22_A6_MISSION_COUNT &&
    run.max_jobs === M22_A6_MAX_JOBS &&
    run.max_attempts === M22_A6_MAX_ATTEMPTS &&
    Number.isFinite(startedAt) && startedAt <= Number(nowMs) &&
    Number.isFinite(expectedExpiry) && expectedExpiry > Number(nowMs) &&
    scope.scope_id === m22A6ChildScopeIdV1(runId, ordinal) &&
    scope.run_id === runId &&
    scope.mission_id === id &&
    scope.job_id === expectedJobId &&
    scope.owner_user_id === owner &&
    scope.request_id === request &&
    scope.goal_hash === expectedHash &&
    scope.allowed_device_id === M22_A6_ALLOWED_DEVICE_ID &&
    scope.operation === "shell.execute" &&
    norm(goal) === expectedGoal &&
    scope.command === expectedStep.input.command &&
    scope.artifact_path === expectedStep.policy.allowed_artifact_path &&
    scope.ordinal === ordinal &&
    scope.scheduled_offset_hours === M22_A6_MISSION_OFFSETS_HOURS[ordinal - 1] &&
    Number.isFinite(scopeExpiry) && scopeExpiry > Number(nowMs) && scopeExpiry <= expectedExpiry &&
    metadata.mission_wonder_2_a6_run_id === runId &&
    metadata.mission_wonder_2_a6_run_scope_id === run.scope_id &&
    metadata.mission_wonder_2_a6_scope_id === scope.scope_id &&
    metadata.mission_wonder_2_a6_goal_hash === expectedHash &&
    metadata.mission_wonder_2_a6_allowed_device_id === M22_A6_ALLOWED_DEVICE_ID &&
    metadata.mission_wonder_2_a6_ordinal === ordinal &&
    metadata.mission_wonder_2_a6_continuity === true &&
    metadata.mission_wonder_2_a6_human_gate_ref === run.human_gate_ref &&
    metadata.user_id === owner &&
    (metadata.owner_user_id == null || metadata.owner_user_id === owner) &&
    metadata.request_id === request &&
    metadata.source_application === "aria-app-v1" &&
    metadata.goal_source === "user" &&
    metadata.execution_lane === "user" &&
    statuses.includes(String(scope.status || ""))
  );
}

function m22A6CanonicalValueV1(value) {
  if (Array.isArray(value)) return value.map(m22A6CanonicalValueV1);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, m22A6CanonicalValueV1(value[key])]));
}

export function m22A6MissionPlanMatchesV1({ mission, deviceId = M22_A6_ALLOWED_DEVICE_ID, runId, ordinal, humanGateRef }) {
  if (!mission || typeof mission !== "object" || Array.isArray(mission) ||
      norm(deviceId) !== M22_A6_ALLOWED_DEVICE_ID) return false;
  try {
    const expectedStep = m22A6BuildContinuityProbeStepV1(deviceId, runId, ordinal, humanGateRef);
    const plan = mission.checkpoint?.plan;
    if (!Array.isArray(plan) || plan.length !== 1) return false;
    if (JSON.stringify(m22A6CanonicalValueV1(plan[0])) !== JSON.stringify(m22A6CanonicalValueV1(expectedStep))) return false;
    if (Number(mission.total_steps) !== 1) return false;
    if (!Number.isSafeInteger(Number(mission.current_step)) ||
        !Number.isSafeInteger(Number(mission.completed_steps))) return false;
    if (Number(mission.current_step) < 0 || Number(mission.current_step) > 1 ||
        Number(mission.completed_steps) < 0 || Number(mission.completed_steps) > 1) return false;
    if (Number(mission.completed_steps) > Number(mission.current_step)) return false;
    return ["queued", "planning", "running", "waiting", "succeeded"].includes(String(mission.status || ""));
  } catch {
    return false;
  }
}
