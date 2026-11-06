const norm = (value) => typeof value === "string" ? value.trim() : "";
const projectNorm = (value) => value == null || String(value).trim() === "" ? null : String(value).trim();

export const M22_A5_SCOPE_ID = "mission_wonder_2_a5_authorized_once";
export const M22_A5_MISSION_ID = "mission_a5_authorized_once";
export const M22_A5_SCOPE_KEY = "mission-wonder-2-step5-a5:single-authorized-recovery";
export const M22_A5_STEP_ID = "a5_idempotent_recovery_marker";
export const M22_A5_ARTIFACT_PATH = "C:\\Windows\\Temp\\ARIA-MW2-A5\\mission_a5_authorized_once\\proof.txt";
export const M22_A5_MARKER = "MISSION_WONDER_2_A5_RECOVERY_V1";

export async function m22A5GoalIdentityHashV1(userId, goal, projectId = null) {
  const payload = JSON.stringify({ version: 1, user_id: norm(userId), goal: norm(goal), project_id: projectNorm(projectId) });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function m22A5ExpectedJobIdV1(missionId = M22_A5_MISSION_ID, stepId = M22_A5_STEP_ID) {
  const safe = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 28);
  // Keep the canonical runner's historic literal "\\0" separator exactly.
  const raw = String(missionId) + "\\0" + String(stepId) + "\\0" + "1";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const suffix = Array.from(new Uint8Array(digest)).slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return "uo_" + safe(missionId) + "_" + safe(stepId) + "_a1_" + suffix;
}

export async function m22A5ScopeRowMatchesV1({
  scope, metadata, missionId, userId, requestId, goal, projectId = null,
  requiredStatuses = ["claimed", "bound"], nowMs = Date.now(),
}) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) ||
      !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const owner = norm(userId), request = norm(requestId), id = norm(missionId);
  if (!owner || !request || id !== M22_A5_MISSION_ID || projectNorm(projectId) !== null ||
      projectNorm(metadata.project_id) !== null) return false;
  const expectedHash = await m22A5GoalIdentityHashV1(owner, goal, null);
  const expectedJobId = await m22A5ExpectedJobIdV1(id, M22_A5_STEP_ID);
  const expiry = Date.parse(String(scope.expires_at || ""));
  const statuses = Array.isArray(requiredStatuses) ? requiredStatuses.map(String) : [];
  return Boolean(
    scope.scope_id === M22_A5_SCOPE_ID &&
    scope.scope_key === M22_A5_SCOPE_KEY &&
    scope.mission_id === id &&
    scope.owner_user_id === owner &&
    scope.request_id === request &&
    scope.goal_hash === expectedHash &&
    scope.job_id === expectedJobId &&
    scope.allowed_device_id === metadata.mission_wonder_2_a5_allowed_device_id &&
    metadata.mission_wonder_2_a5_scope_id === M22_A5_SCOPE_ID &&
    metadata.mission_wonder_2_a5_goal_hash === expectedHash &&
    metadata.mission_wonder_2_a5_recovery === true &&
    metadata.user_id === owner &&
    (metadata.owner_user_id == null || metadata.owner_user_id === owner) &&
    metadata.request_id === request &&
    metadata.source_application === "aria-app-v1" &&
    metadata.goal_source === "user" &&
    metadata.execution_lane === "user" &&
    statuses.includes(String(scope.status || "")) &&
    Number.isFinite(expiry) && expiry > Number(nowMs)
  );
}

export function m22A5BuildRecoveryProbeStepV1(deviceId) {
  const id = norm(deviceId);
  if (!id) throw new Error("a5_device_id_required");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$directory = 'C:\\Windows\\Temp\\ARIA-MW2-A5\\mission_a5_authorized_once'",
    "$artifact = Join-Path $directory 'proof.txt'",
    "$marker = '" + M22_A5_MARKER + "'",
    "[IO.Directory]::CreateDirectory($directory) | Out-Null",
    "$files = @(Get-ChildItem -LiteralPath $directory -File -Force -ErrorAction SilentlyContinue)",
    "if ($files.Count -gt 1) { throw 'A5_ARTIFACT_DUPLICATES_FOUND' }",
    "if ($files.Count -eq 1 -and $files[0].FullName -cne $artifact) { throw 'A5_UNEXPECTED_ARTIFACT_FOUND' }",
    "if ([IO.File]::Exists($artifact)) {",
    "  if ($files.Count -ne 1) { throw 'A5_ARTIFACT_COUNT_MISMATCH' }",
    "  $existing = [IO.File]::ReadAllText($artifact, [Text.Encoding]::ASCII)",
    "  if ($existing -cne $marker) { throw 'A5_ARTIFACT_CONTENT_MISMATCH' }",
    "  $sha = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()",
    "  Write-Output ('A5_RECOVERY_ALREADY_IDENTICAL;attempt=2;files=1;sha256=' + $sha + ';artifact=' + $artifact)",
    "  exit 0",
    "}",
    "[IO.File]::WriteAllText($artifact, $marker, [Text.Encoding]::ASCII)",
    "$sha = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()",
    "Write-Output ('A5_FIRST_ATTEMPT_ARTIFACT_CREATED;files=1;sha256=' + $sha + ';artifact=' + $artifact)",
    "while ($true) { Start-Sleep -Seconds 2 }"
  ].join("\n");
  return {
    id: M22_A5_STEP_ID,
    operation: "shell.execute",
    executor_type: "device",
    risk: "WRITE",
    target: { type: "device", device_id: id },
    input: { command: script, cwd: "C:\\Windows\\Temp" },
    policy: {
      read_only: false,
      mission_wonder_2_a5_recovery: true,
      allowed_artifact_path: M22_A5_ARTIFACT_PATH,
      idempotent_artifact: true,
      max_artifacts: 1
    },
    authorization: {
      status: "approved",
      risk_class: "WRITE",
      evidence_ref: "mission-wonder-2-step5-a5-v1-owner-authorization"
    },
    timeout_ms: 900000,
    retryable: false,
    max_attempts: 2,
    depends_on: [],
    verify: {
      expected_exit_code: 0,
      stdout_contains: "A5_RECOVERY_ALREADY_IDENTICAL"
    }
  };
}

export function m22A5RecoveryProbeStepMatchesV1(step, deviceId) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return false;
  const expected = m22A5BuildRecoveryProbeStepV1(deviceId);
  return JSON.stringify(step) === JSON.stringify(expected);
}
