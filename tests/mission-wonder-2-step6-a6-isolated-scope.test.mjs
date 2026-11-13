import assert from "node:assert/strict";
import fs from "node:fs";
import { webcrypto } from "node:crypto";
import {
  M22_A6_ALLOWED_DEVICE_ID,
  M22_A6_WINDOW_HOURS,
  M22_A6_MISSION_COUNT,
  M22_A6_MAX_JOBS,
  M22_A6_MAX_ATTEMPTS,
  M22_A6_MISSION_OFFSETS_HOURS,
  m22A6RunScopeIdV1,
  m22A6MissionIdV1,
  m22A6StepIdV1,
  m22A6ChildScopeIdV1,
  m22A6GoalV1,
  m22A6GoalIdentityHashV1,
  m22A6ExpectedJobIdV1,
  m22A6ArtifactPathV1,
  m22A6BuildContinuityProbeStepV1,
  m22A6BuildRunScopeSpecsV1,
  m22A6ContinuityProbeStepMatchesV1,
  m22A6ScopeRowMatchesV1,
  m22A6MissionPlanMatchesV1,
} from "../supabase/functions/_shared/mission-wonder-2-a6-scope-v1.mjs";

globalThis.crypto ??= webcrypto;
const identityFixtureRun = "m22-a6-abcdef123456";
const identityFixtureMission = m22A6MissionIdV1(identityFixtureRun, 1);
const identityFixtureGoal = m22A6GoalV1(identityFixtureRun, 1);
assert.equal(await m22A6ExpectedJobIdV1(identityFixtureMission, m22A6StepIdV1(1)),
  "uo_mission_m22_a6_abcdef123456__a6_continuity_marker_01_a1_1bba4d59ea4995e2");
assert.equal(await m22A6GoalIdentityHashV1("a6-owner-user", identityFixtureGoal, null),
  "064a6a41f05d10bfa3b2bc5e25a1471534dee6c773f2722d98ce3aa048591f40");

const RUN_ID = "m22-a6-abcdef123456";
const OWNER = "a6-owner-user";
const REQUEST = "a6-request-0001";
const DEVICE = M22_A6_ALLOWED_DEVICE_ID;
const HUMAN_GATE_REF = "a6-human-gate-1730912400.123";
const NOW = Date.now();
const runExpiry = new Date(NOW + 25 * 60 * 60 * 1000).toISOString();
const runStarted = new Date(NOW - 1000).toISOString();

assert.equal(M22_A6_WINDOW_HOURS, 24);
assert.equal(M22_A6_MISSION_COUNT, 5);
assert.equal(M22_A6_MAX_JOBS, 5);
assert.equal(M22_A6_MAX_ATTEMPTS, 1);
assert.deepEqual(M22_A6_MISSION_OFFSETS_HOURS, [1, 6, 12, 18, 23]);
assert.equal(m22A6RunScopeIdV1(RUN_ID), "mission_wonder_2_a6_run_m22-a6-abcdef123456");
assert.equal(m22A6MissionIdV1(RUN_ID, 1), "mission_m22_a6_abcdef123456_01");
assert.equal(m22A6StepIdV1(5), "a6_continuity_marker_05");
assert.equal(m22A6ChildScopeIdV1(RUN_ID, 3), "mission_wonder_2_a6_m22-a6-abcdef123456_03");
assert.equal(m22A6ArtifactPathV1(RUN_ID, 4),
  "C:\\Windows\\Temp\\ARIA-MW2-A6\\m22-a6-abcdef123456\\mission-04\\proof-04.txt");
assert.throws(() => m22A6MissionIdV1(RUN_ID, 6), /ordinal_invalid/);
assert.throws(() => m22A6BuildContinuityProbeStepV1("other-device", RUN_ID, 1, HUMAN_GATE_REF), /device_not_allowlisted/);
assert.throws(() => m22A6ArtifactPathV1("m22-a6-../../evil", 1), /run_id_invalid/);

const canonicalArmSpecs = await m22A6BuildRunScopeSpecsV1({
  runId: RUN_ID,
  userId: OWNER,
  humanGateRef: HUMAN_GATE_REF,
});
assert.equal(canonicalArmSpecs.length, M22_A6_MISSION_COUNT);
for (const [index, spec] of canonicalArmSpecs.entries()) {
  const ordinal = index + 1;
  const canonicalStep = m22A6BuildContinuityProbeStepV1(DEVICE, RUN_ID, ordinal, HUMAN_GATE_REF);
  assert.equal(spec.ordinal, ordinal);
  assert.equal(spec.command, canonicalStep.input.command);
  assert.equal(spec.command, spec.command.trim(), "arm payload command must have no outer whitespace");
  assert.equal(spec.command.startsWith("\n"), false);
  assert.equal(spec.command.endsWith("\n"), false);
  assert.equal(spec.mission_id, m22A6MissionIdV1(RUN_ID, ordinal));
  assert.equal(spec.scope_id, m22A6ChildScopeIdV1(RUN_ID, ordinal));
  assert.equal(spec.request_id, RUN_ID + "." + ordinal);
  assert.equal(spec.job_id, await m22A6ExpectedJobIdV1(spec.mission_id, canonicalStep.id));
}

for (let ordinal = 1; ordinal <= M22_A6_MISSION_COUNT; ordinal += 1) {
  const missionId = m22A6MissionIdV1(RUN_ID, ordinal);
  const stepId = m22A6StepIdV1(ordinal);
  const jobId = await m22A6ExpectedJobIdV1(missionId, stepId);
  assert.match(jobId, /^uo_[a-zA-Z0-9_-]+_a1_[a-f0-9]{16}$/);
  const step = m22A6BuildContinuityProbeStepV1(DEVICE, RUN_ID, ordinal, HUMAN_GATE_REF);
  assert.equal(m22A6ContinuityProbeStepMatchesV1(step, DEVICE, RUN_ID, ordinal, HUMAN_GATE_REF), true);
  assert.equal(step.id, stepId);
  assert.equal(step.operation, "shell.execute");
  assert.equal(step.risk, "WRITE");
  assert.equal(step.timeout_ms, 60000);
  assert.equal(step.retryable, false);
  assert.equal(step.max_attempts, 1);
  assert.equal(step.policy.mission_wonder_2_a6_continuity, true);
  assert.equal(step.policy.allowed_artifact_path, m22A6ArtifactPathV1(RUN_ID, ordinal));
  assert.equal(step.policy.max_artifacts, 1);
  assert.equal(step.policy.network_access, false);
  assert.equal(step.policy.external_mutations, false);
  assert.match(step.input.command, /\[IO\.File\]::WriteAllText\(\$artifact, \$marker/);
  assert.match(step.input.command, /\[IO\.File\]::ReadAllText\(\$artifact/);
  assert.match(step.input.command, /A6_ARTIFACT_DUPLICATES_FOUND/);
  assert.match(step.input.command, /A6_ARTIFACT_CONTENT_MISMATCH/);
  assert.match(step.input.command, /A6_ARTIFACT_VERIFIED;mode=identical/);
  assert.equal(step.verify.stdout_contains, "A6_ARTIFACT_VERIFIED;mode=");
  for (const mode of ["created", "identical"]) {
    const sample = `A6_ARTIFACT_VERIFIED;mode=${mode};sequence=${String(ordinal).padStart(2, "0")};sha256=${"a".repeat(64)};artifact=${step.policy.allowed_artifact_path}`;
    assert.ok(sample.includes(step.verify.stdout_contains));
    assert.match(sample, new RegExp("^A6_ARTIFACT_VERIFIED;mode=(created|identical);sequence=" + String(ordinal).padStart(2, "0") + ";sha256=[a-f0-9]{64};artifact="));
    assert.ok(sample.endsWith(step.policy.allowed_artifact_path));
  }
  assert.equal(/Remove-Item|Set-Content|Invoke-WebRequest|Invoke-RestMethod|Restart-Computer|Start-Sleep/i.test(step.input.command), false);
  assert.equal(m22A6ContinuityProbeStepMatchesV1({ ...step, timeout_ms: 60001 }, DEVICE, RUN_ID, ordinal, HUMAN_GATE_REF), false);
}

const ordinal = 1;
const missionId = m22A6MissionIdV1(RUN_ID, ordinal);
const goal = m22A6GoalV1(RUN_ID, ordinal);
const goalHash = await m22A6GoalIdentityHashV1(OWNER, goal, null);
const jobId = await m22A6ExpectedJobIdV1(missionId, m22A6StepIdV1(ordinal));
const step = m22A6BuildContinuityProbeStepV1(DEVICE, RUN_ID, ordinal, HUMAN_GATE_REF);
const run = {
  run_id: RUN_ID,
  scope_id: m22A6RunScopeIdV1(RUN_ID),
  owner_user_id: OWNER,
  allowed_device_id: DEVICE,
  status: "running",
  window_hours: 24,
  max_missions: 5,
  max_jobs: 5,
  max_attempts: 1,
  human_gate_ref: HUMAN_GATE_REF,
  started_at: runStarted,
  expires_at: runExpiry,
};
const scope = {
  scope_id: m22A6ChildScopeIdV1(RUN_ID, ordinal),
  run_id: RUN_ID,
  mission_id: missionId,
  job_id: jobId,
  owner_user_id: OWNER,
  request_id: REQUEST,
  goal_hash: goalHash,
  allowed_device_id: DEVICE,
  operation: "shell.execute",
  command: step.input.command,
  artifact_path: step.policy.allowed_artifact_path,
  ordinal,
  scheduled_offset_hours: 1,
  status: "bound",
  expires_at: runExpiry,
};
const metadata = {
  mission_wonder_2_a6_run_id: RUN_ID,
  mission_wonder_2_a6_run_scope_id: run.scope_id,
  mission_wonder_2_a6_scope_id: scope.scope_id,
  mission_wonder_2_a6_goal_hash: goalHash,
  mission_wonder_2_a6_allowed_device_id: DEVICE,
  mission_wonder_2_a6_ordinal: ordinal,
  mission_wonder_2_a6_continuity: true,
  mission_wonder_2_a6_human_gate_ref: HUMAN_GATE_REF,
  user_id: OWNER,
  owner_user_id: OWNER,
  request_id: REQUEST,
  source_application: "aria-app-v1",
  goal_source: "user",
  execution_lane: "user",
  project_id: null,
};
const args = {
  run, scope, metadata, missionId, userId: OWNER, requestId: REQUEST, goal,
  requiredStatuses: ["bound"], nowMs: NOW,
};
assert.equal(await m22A6ScopeRowMatchesV1(args), true);
assert.equal(await m22A6ScopeRowMatchesV1({
  ...args,
  scope: { ...scope, command: "\n" + scope.command + "\n" },
}), false, "the runtime must reject the exact leading/trailing newline defect from the failed live run");
for (const change of [
  { run: { ...run, status: "revoked" } },
  { run: { ...run, max_jobs: 6 } },
  { run: { ...run, allowed_device_id: "other-device" } },
  { run: { ...run, human_gate_ref: "a6-human-gate-invalid" } },
  { scope: { ...scope, status: "revoked" } },
  { scope: { ...scope, job_id: "different-job" } },
  { scope: { ...scope, ordinal: 2 } },
  { scope: { ...scope, scheduled_offset_hours: 2 } },
  { scope: { ...scope, artifact_path: "C:\\Windows\\Temp\\other.txt" } },
  { scope: { ...scope, expires_at: new Date(NOW - 1).toISOString() } },
  { metadata: { ...metadata, mission_wonder_2_a6_continuity: false } },
  { metadata: { ...metadata, mission_wonder_2_a6_goal_hash: "0".repeat(64) } },
  { metadata: { ...metadata, mission_wonder_2_a6_allowed_device_id: "other-device" } },
  { metadata: { ...metadata, request_id: "other-request" } },
]) {
  assert.equal(await m22A6ScopeRowMatchesV1({ ...args, ...change }), false);
}
assert.equal(await m22A6ScopeRowMatchesV1({ ...args, userId: "other-owner" }), false);
assert.equal(await m22A6ScopeRowMatchesV1({ ...args, goal: "mutated objective" }), false);
assert.equal(await m22A6ScopeRowMatchesV1({ ...args, projectId: "battlecruiser" }), false);

const missionPlan = {
  status: "queued",
  current_step: 0,
  completed_steps: 0,
  total_steps: 1,
  checkpoint: { plan: [step] },
};
assert.equal(await m22A6MissionPlanMatchesV1({ mission: missionPlan, runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF }), true);

const recoveredMissionPlan = {
  ...missionPlan,
  status: "waiting",
  checkpoint: {
    plan: [{ ...step, max_attempts: 2 }],
    attempts: { [stepId]: 2 },
    pending_jobs: {
      [stepId]: { status: "queued", attempt: 2, job_id: jobId },
    },
    recovery: {
      status: "waiting_for_async_executor",
      reason: "a6_same_job_idempotent_recovery",
      job_id: jobId,
      previous_attempt: 1,
      next_attempt: 2,
      new_job_created: false,
      at: new Date(NOW).toISOString(),
    },
  },
};
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: recoveredMissionPlan, runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), true, "the exact same-job attempt-2 checkpoint must pass the frozen A6 gate");
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: {
    ...recoveredMissionPlan,
    checkpoint: {
      ...recoveredMissionPlan.checkpoint,
      recovery: { ...recoveredMissionPlan.checkpoint.recovery, job_id: "different-job" },
    },
  },
  runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false, "recovery must retain the deterministic original job_id");
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: {
    ...recoveredMissionPlan,
    checkpoint: {
      ...recoveredMissionPlan.checkpoint,
      pending_jobs: { [stepId]: { status: "queued", attempt: 2, job_id: "different-job" } },
    },
  },
  runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false, "pending job must match the recovered job_id");
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: {
    ...recoveredMissionPlan,
    checkpoint: {
      ...recoveredMissionPlan.checkpoint,
      attempts: { [stepId]: 1 },
    },
  },
  runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false, "checkpoint attempt counter must be exactly 2");
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: {
    ...recoveredMissionPlan,
    checkpoint: { plan: [{ ...step, max_attempts: 2 }] },
  },
  runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false, "attempt 2 without durable recovery evidence must fail closed");
assert.equal(step.authorization.evidence_ref, HUMAN_GATE_REF);
assert.throws(() => m22A6BuildContinuityProbeStepV1(DEVICE, RUN_ID, ordinal, "not-a-human-gate"), /human_gate_ref_invalid/);
assert.throws(() => m22A6BuildContinuityProbeStepV1(DEVICE, RUN_ID, ordinal, "a6-human-gate-1730912400x123"), /human_gate_ref_invalid/);
const databaseOrderedStep = Object.fromEntries(Object.entries(step).reverse());
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: { ...missionPlan, checkpoint: { plan: [databaseOrderedStep] } },
  runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), true);
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: { ...missionPlan, checkpoint: { plan: [{ ...step, timeout_ms: 60001 }] } },
  runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false);
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: { ...missionPlan, total_steps: 2 }, runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false);
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: { ...missionPlan, checkpoint: { plan: [step, step] } }, runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false);
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: { ...missionPlan, status: "blocked" }, runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false);
assert.equal(await m22A6MissionPlanMatchesV1({
  mission: missionPlan, deviceId: "other-device", runId: RUN_ID, ordinal, humanGateRef: HUMAN_GATE_REF,
}), false);


const supabaseDeployWorkflow = fs.readFileSync(".github/workflows/supabase-canonical-deploy.yml", "utf8");
const pwaDeployWorkflow = fs.readFileSync(".github/workflows/aria-pwa-fast-deploy.yml", "utf8");
const cloudflareDeployWorkflow = fs.readFileSync(".github/workflows/aria-cloudflare-deploy.yml", "utf8");
assert.match(supabaseDeployWorkflow, /'!supabase\/functions\/_shared\/mission-wonder-2-a6-scope-v1\.mjs'/);
assert.match(pwaDeployWorkflow, /'supabase\/functions\/_shared\/mission-wonder-2-a6-scope-v1\.mjs'/);
assert.match(pwaDeployWorkflow, /'package\.json'/);
assert.match(pwaDeployWorkflow, /'.github\/workflows\/mission-wonder-2-step6-a6-isolated-contract\.yml'/);
assert.match(pwaDeployWorkflow, /'tests\/mission-wonder-2-step6-a6-isolated-scope\.test\.mjs'/);
assert.match(cloudflareDeployWorkflow, /'.github\/workflows\/mission-wonder-2-step6-a6-isolated-contract\.yml'/);
assert.match(cloudflareDeployWorkflow, /'tests\/mission-wonder-2-step6-a6-isolated-scope\.test\.mjs'/);
assert.match(pwaDeployWorkflow, /'.github\/workflows\/mission-wonder-2-step6-a6-migration-cli\.yml'/);
assert.match(pwaDeployWorkflow, /'.github\/scripts\/mission-wonder-2-step6-a6-isolated-scope-v1\.sql'/);
assert.match(pwaDeployWorkflow, /'supabase\/migrations\/\*_aria_mission_wonder_2_a6_isolated_scope_v1\.sql'/);
assert.match(cloudflareDeployWorkflow, /'.github\/workflows\/mission-wonder-2-step6-a6-migration-cli\.yml'/);
assert.match(cloudflareDeployWorkflow, /'.github\/scripts\/mission-wonder-2-step6-a6-isolated-scope-v1\.sql'/);
assert.match(cloudflareDeployWorkflow, /'supabase\/migrations\/\*_aria_mission_wonder_2_a6_isolated_scope_v1\.sql'/);
assert.match(pwaDeployWorkflow, /'.github\/workflows\/mission-wonder-2-step6-a6-migration-cli\.yml'/);
assert.match(pwaDeployWorkflow, /'.github\/scripts\/mission-wonder-2-step6-a6-isolated-scope-v1\.sql'/);
assert.match(cloudflareDeployWorkflow, /'.github\/workflows\/mission-wonder-2-step6-a6-migration-cli\.yml'/);
assert.match(cloudflareDeployWorkflow, /'.github\/scripts\/mission-wonder-2-step6-a6-isolated-scope-v1\.sql'/);

console.log("MISSION_WONDER_2_STEP6_A6_ISOLATED_SCOPE_CONTRACT=PASS");

const a6ScopeTemplate = fs.readFileSync(".github/scripts/mission-wonder-2-step6-a6-isolated-scope-v1.sql", "utf8");
const a6IdentityMigration = fs.readFileSync("supabase/migrations/20261110120000_aria_mission_wonder_2_a6_isolated_scope_v1.sql", "utf8");
for (const source of [a6ScopeTemplate, a6IdentityMigration]) {
  assert.ok(source.includes("expected_goal_hash := encode(extensions.digest"));
  assert.ok(source.includes("expected_job_id := 'uo_'||left(expected_mission,28)"));
  assert.ok(source.includes("item->>'goal_hash' is distinct from expected_goal_hash"));
  assert.ok(source.includes("item->>'job_id' is distinct from expected_job_id"));
}
const a6ContractWorkflow = fs.readFileSync(".github/workflows/mission-wonder-2-step6-a6-isolated-contract.yml", "utf8");
assert.ok(a6ContractWorkflow.includes("psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261110120000_aria_mission_wonder_2_a6_isolated_scope_v1.sql"));
assert.ok(a6ContractWorkflow.includes("create extension if not exists pgcrypto with schema extensions"));
