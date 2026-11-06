import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  M22_A6_FAULT_SCENARIOS_V1,
  M22_A6_SOAK_WINDOWS_V1,
  m22A6BuildSoakReportV1,
} from "../autonomy/mission-wonder-2-a6-soak-v1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const start = Date.parse("2026-01-01T00:00:00.000Z");
const hours = count => new Date(start + count * 60 * 60 * 1000).toISOString();
const thresholds = {
  minimumDurationHours: 24,
  minimumMissions: 5,
  heartbeatIntervalMs: 5000,
  maxNormalHeartbeatGapMs: 15000,
  maxRecoveryMs: 120000,
  maxP95LatencyMs: 90000,
  maxTotalCostUsd: 0.05,
  maxAttemptsPerJob: 3,
  maxBacklogAgeMs: 300000,
};
const missions = Array.from({ length: 5 }, (_, index) => ({
  missionId: "a6-mission-" + index,
  jobId: "a6-job-" + index,
  status: "succeeded",
  objectiveVerified: true,
  verificationEventId: "a6-verified-event-" + index,
  verificationEventCount: 1,
  attemptCount: index === 2 ? 2 : 1,
  artifactSha256: [(index.toString(16).padStart(64, "0"))],
  duplicateCount: 0,
  activeAtEnd: false,
}));
const faultScenarios = M22_A6_FAULT_SCENARIOS_V1.map((name, index) => ({
  name, injected: true, detected: true, recovered: true, recoveryMs: 15000 + index * 1000,
}));

const ambientSnapshot = {
  legacyNonterminalMissionCount: 291,
  legacyNonterminalMissionFingerprint: "713960e84a7ec49b55fc765ef627e8ff",
  nonA6ActiveJobCount: 0,
  nonA6ActiveJobFingerprint: "d41d8cd98f00b204e9800998ecf8427e",
  cron48Active: false,
  cron49Active: false,
  cron50Active: false,
  missionExecutionPaused: true,
};
const validEvidence = {
  startedAt: hours(0),
  finishedAt: hours(24),
  evidenceClassification: "SIMULATED",
  thresholds,
  missions,
  heartbeatGaps: [
    { gapMs: 5000, expectedOutage: false },
    { gapMs: 10000, expectedOutage: false },
    { gapMs: 45000, expectedOutage: true, detected: true, recovered: true },
  ],
  faultScenarios,
  latencySamplesMs: [900, 1200, 1500, 2400, 3000, 4200, 5800, 7000, 8500, 12000],
  costSamplesUsd: [0.001, 0.001, 0.001, 0.001, 0.001],
  backlogSamples: [
    { pendingJobs: 2, oldestPendingAgeMs: 1000 },
    { pendingJobs: 0, oldestPendingAgeMs: 0 },
  ],
  orphanJobs: 0,
  orphanProcesses: 0,
  ambientBaseline: ambientSnapshot,
  ambientFinal: { ...ambientSnapshot },
};

const report = m22A6BuildSoakReportV1(validEvidence);
assert.equal(report.status, "PASS");
assert.deepEqual(report.blockers, []);
assert.equal(report.evidenceClassification, "UNATTESTED_INPUT");
assert.equal(report.liveAttestation, "NOT_CHECKED_BY_PURE_EVALUATOR");
assert.equal(report.metrics.elapsedHours, 24);
assert.equal(report.metrics.missionCount, 5);
assert.equal(report.metrics.independentlyVerifiedMissionCount, 5);
assert.equal(report.metrics.uniqueJobCount, 5);
assert.equal(report.metrics.faultScenariosRecovered, 5);
assert.equal(report.metrics.finalPendingJobs, 0);
assert.equal(report.metrics.orphanJobs, 0);
assert.equal(report.metrics.orphanProcesses, 0);
assert.equal(report.metrics.ambient.legacyNonterminalMissionCount, 291);
assert.equal(report.metrics.ambient.nonA6ActiveJobCount, 0);
assert.equal(report.metrics.ambient.ambientFingerprintUnchanged, true);
assert.equal(report.metrics.ambient.crons48_49_50RemainDisabled, true);
assert.equal(report.metrics.ambient.globalMissionFreezeRemainsEnabled, true);
assert.ok(Math.abs(report.metrics.totalCostUsd - 0.005) < 1e-9);
assert.equal(M22_A6_SOAK_WINDOWS_V1.initial_hours, 24);
assert.equal(M22_A6_SOAK_WINDOWS_V1.reinforced_hours, 72);
assert.equal(M22_A6_SOAK_WINDOWS_V1.proposed_minimum_missions_per_24h, 5);
assert.equal(M22_A6_SOAK_WINDOWS_V1.proposed_minimum_missions_per_72h, 15);

const insufficient72HourVolume = m22A6BuildSoakReportV1({
  ...validEvidence,
  finishedAt: hours(72),
  thresholds: { ...thresholds, minimumDurationHours: 72, minimumMissions: 14 },
});
assert.equal(insufficient72HourVolume.status, "BLOCKED");
assert.ok(insufficient72HourVolume.blockers.includes("threshold_minimum_missions_invalid"));

const excessiveHeartbeatTolerance = m22A6BuildSoakReportV1({
  ...validEvidence,
  thresholds: { ...thresholds, maxNormalHeartbeatGapMs: 15001 },
});
assert.equal(excessiveHeartbeatTolerance.status, "BLOCKED");
assert.ok(excessiveHeartbeatTolerance.blockers.includes("heartbeat_threshold_exceeds_three_intervals"));

const selfLabeledLiveReport = m22A6BuildSoakReportV1({ ...validEvidence, evidenceClassification: "LIVE" });
assert.equal(selfLabeledLiveReport.evidenceClassification, "UNATTESTED_INPUT");
assert.equal(selfLabeledLiveReport.liveAttestation, "NOT_CHECKED_BY_PURE_EVALUATOR");

const missingArtifact = missions.map(item => ({ ...item, artifactSha256: [] }));
const missingArtifactReport = m22A6BuildSoakReportV1({ ...validEvidence, missions: missingArtifact });
assert.equal(missingArtifactReport.status, "BLOCKED");
assert.ok(missingArtifactReport.blockers.includes("mission_0_must_have_exactly_one_valid_artifact_hash"));

const missingDuplicateCount = missions.map(item => ({ ...item }));
delete missingDuplicateCount[0].duplicateCount;
const missingDuplicateCountReport = m22A6BuildSoakReportV1({ ...validEvidence, missions: missingDuplicateCount });
assert.equal(missingDuplicateCountReport.status, "BLOCKED");
assert.ok(missingDuplicateCountReport.blockers.includes("mission_0_duplicate_count_missing_or_nonzero"));

const missingCostBudget = m22A6BuildSoakReportV1({
  ...validEvidence,
  thresholds: { ...thresholds, maxTotalCostUsd: undefined },
});
assert.equal(missingCostBudget.status, "BLOCKED");
assert.ok(missingCostBudget.blockers.includes("threshold_max_total_cost_usd_required"));

const shortWindow = m22A6BuildSoakReportV1({ ...validEvidence, finishedAt: hours(23) });
assert.equal(shortWindow.status, "BLOCKED");
assert.ok(shortWindow.blockers.includes("soak_duration_below_declared_minimum"));

const duplicateJob = missions.map(item => ({ ...item }));
duplicateJob[1].jobId = duplicateJob[0].jobId;
const duplicateReport = m22A6BuildSoakReportV1({ ...validEvidence, missions: duplicateJob });
assert.equal(duplicateReport.status, "BLOCKED");
assert.ok(duplicateReport.blockers.includes("job_ids_missing_or_duplicated"));

const duplicateArtifact = missions.map(item => ({ ...item, artifactSha256: [...item.artifactSha256] }));
duplicateArtifact[1].artifactSha256[0] = duplicateArtifact[0].artifactSha256[0];
const duplicateArtifactReport = m22A6BuildSoakReportV1({ ...validEvidence, missions: duplicateArtifact });
assert.equal(duplicateArtifactReport.status, "BLOCKED");
assert.ok(duplicateArtifactReport.blockers.includes("artifact_hashes_missing_invalid_or_duplicated"));

const unverified = missions.map(item => ({ ...item }));
unverified[2].objectiveVerified = false;
const unverifiedReport = m22A6BuildSoakReportV1({ ...validEvidence, missions: unverified });
assert.equal(unverifiedReport.status, "BLOCKED");
assert.ok(unverifiedReport.blockers.includes("mission_2_not_independently_verified_success"));

const missingFault = faultScenarios.filter(item => item.name !== "provider_degraded");
const missingFaultReport = m22A6BuildSoakReportV1({ ...validEvidence, faultScenarios: missingFault });
assert.equal(missingFaultReport.status, "BLOCKED");
assert.ok(missingFaultReport.blockers.includes("fault_scenario_provider_degraded_not_proven"));

const heartbeatFailure = m22A6BuildSoakReportV1({
  ...validEvidence,
  heartbeatGaps: [{ gapMs: 20000, expectedOutage: false }],
});
assert.equal(heartbeatFailure.status, "BLOCKED");
assert.ok(heartbeatFailure.blockers.includes("heartbeat_gap_0_exceeded_threshold"));

const outageFailure = m22A6BuildSoakReportV1({
  ...validEvidence,
  heartbeatGaps: [{ gapMs: 180000, expectedOutage: true, detected: true, recovered: false }],
});
assert.equal(outageFailure.status, "BLOCKED");
assert.ok(outageFailure.blockers.includes("heartbeat_outage_0_not_detected_and_recovered_within_threshold"));

const undetectedOutage = m22A6BuildSoakReportV1({
  ...validEvidence,
  heartbeatGaps: [{ gapMs: 45000, expectedOutage: true, recovered: true }],
});
assert.equal(undetectedOutage.status, "BLOCKED");
assert.ok(undetectedOutage.blockers.includes("heartbeat_outage_0_not_detected_and_recovered_within_threshold"));

const retryFailureMissions = missions.map(item => ({ ...item }));
retryFailureMissions[0].attemptCount = 4;
const retryFailure = m22A6BuildSoakReportV1({ ...validEvidence, missions: retryFailureMissions });
assert.equal(retryFailure.status, "BLOCKED");
assert.ok(retryFailure.blockers.includes("mission_0_attempt_count_out_of_bounds"));

const p95Failure = m22A6BuildSoakReportV1({
  ...validEvidence,
  thresholds: { ...thresholds, maxP95LatencyMs: 1000 },
});
assert.equal(p95Failure.status, "BLOCKED");
assert.ok(p95Failure.blockers.includes("p95_latency_exceeded_threshold"));

const costFailure = m22A6BuildSoakReportV1({
  ...validEvidence,
  thresholds: { ...thresholds, maxTotalCostUsd: 0.001 },
});
assert.equal(costFailure.status, "BLOCKED");
assert.ok(costFailure.blockers.includes("total_cost_exceeded_threshold"));

const backlogFailure = m22A6BuildSoakReportV1({
  ...validEvidence,
  backlogSamples: [{ pendingJobs: 2, oldestPendingAgeMs: 999999 }],
});
assert.equal(backlogFailure.status, "BLOCKED");
assert.ok(backlogFailure.blockers.includes("backlog_not_drained_at_end"));
assert.ok(backlogFailure.blockers.includes("backlog_sample_0_oldest_age_invalid_or_exceeded"));

const invalidBacklogSample = m22A6BuildSoakReportV1({
  ...validEvidence,
  backlogSamples: [
    { pendingJobs: 1, oldestPendingAgeMs: -1 },
    { pendingJobs: 0, oldestPendingAgeMs: 0 },
  ],
});
assert.equal(invalidBacklogSample.status, "BLOCKED");
assert.ok(invalidBacklogSample.blockers.includes("backlog_sample_0_oldest_age_invalid_or_exceeded"));

const orphanFailure = m22A6BuildSoakReportV1({ ...validEvidence, orphanJobs: 1 });
assert.equal(orphanFailure.status, "BLOCKED");
assert.ok(orphanFailure.blockers.includes("orphan_jobs_present_or_unmeasured"));

const orphanProcessFailure = m22A6BuildSoakReportV1({ ...validEvidence, orphanProcesses: 1 });
assert.equal(orphanProcessFailure.status, "BLOCKED");
assert.ok(orphanProcessFailure.blockers.includes("orphan_processes_present_or_unmeasured"));

const unmeasuredOrphanProcesses = m22A6BuildSoakReportV1({ ...validEvidence, orphanProcesses: null });
assert.equal(unmeasuredOrphanProcesses.status, "BLOCKED");
assert.ok(unmeasuredOrphanProcesses.blockers.includes("orphan_processes_present_or_unmeasured"));

const missingCostSample = m22A6BuildSoakReportV1({ ...validEvidence, costSamplesUsd: [0.001] });
assert.equal(missingCostSample.status, "BLOCKED");
assert.ok(missingCostSample.blockers.includes("cost_samples_below_mission_count"));

const missingLatencySample = m22A6BuildSoakReportV1({ ...validEvidence, latencySamplesMs: [1000] });
assert.equal(missingLatencySample.status, "BLOCKED");
assert.ok(missingLatencySample.blockers.includes("latency_samples_below_mission_count"));

const unmeasuredOrphanCount = m22A6BuildSoakReportV1({ ...validEvidence, orphanJobs: null });
assert.equal(unmeasuredOrphanCount.status, "BLOCKED");
assert.ok(unmeasuredOrphanCount.blockers.includes("orphan_jobs_present_or_unmeasured"));

const coercedCostSample = m22A6BuildSoakReportV1({ ...validEvidence, costSamplesUsd: [null] });
assert.equal(coercedCostSample.status, "BLOCKED");
assert.ok(coercedCostSample.blockers.includes("cost_sample_invalid"));

const missingTypedThreshold = m22A6BuildSoakReportV1({
  ...validEvidence,
  thresholds: { ...thresholds, maxTotalCostUsd: null },
});
assert.equal(missingTypedThreshold.status, "BLOCKED");
assert.ok(missingTypedThreshold.blockers.includes("threshold_max_total_cost_usd_required"));

const changedAmbientMissionCount = m22A6BuildSoakReportV1({
  ...validEvidence,
  ambientFinal: { ...ambientSnapshot, legacyNonterminalMissionCount: 292 },
});
assert.equal(changedAmbientMissionCount.status, "BLOCKED");
assert.ok(changedAmbientMissionCount.blockers.includes("ambient_snapshot_changed_legacyNonterminalMissionCount"));

const changedAmbientMissionFingerprint = m22A6BuildSoakReportV1({
  ...validEvidence,
  ambientFinal: { ...ambientSnapshot, legacyNonterminalMissionFingerprint: "ffffffffffffffffffffffffffffffff" },
});
assert.equal(changedAmbientMissionFingerprint.status, "BLOCKED");
assert.ok(changedAmbientMissionFingerprint.blockers.includes("ambient_snapshot_changed_legacyNonterminalMissionFingerprint"));

const newlyEnabledLegacyCron = m22A6BuildSoakReportV1({
  ...validEvidence,
  ambientFinal: { ...ambientSnapshot, cron49Active: true },
});
assert.equal(newlyEnabledLegacyCron.status, "BLOCKED");
assert.ok(newlyEnabledLegacyCron.blockers.includes("ambient_baseline_or_final_snapshot_missing_or_invalid"));

const missingAmbientSnapshot = m22A6BuildSoakReportV1({
  ...validEvidence,
  ambientFinal: undefined,
});
assert.equal(missingAmbientSnapshot.status, "BLOCKED");
assert.ok(missingAmbientSnapshot.blockers.includes("ambient_baseline_or_final_snapshot_missing_or_invalid"));

const coercedBacklogSample = m22A6BuildSoakReportV1({
  ...validEvidence,
  backlogSamples: [{ pendingJobs: null, oldestPendingAgeMs: null }],
});
assert.equal(coercedBacklogSample.status, "BLOCKED");
assert.ok(coercedBacklogSample.blockers.includes("backlog_sample_0_pending_job_count_invalid"));
assert.ok(coercedBacklogSample.blockers.includes("backlog_sample_0_oldest_age_invalid_or_exceeded"));

const stringAttemptCount = missions.map(item => ({ ...item }));
stringAttemptCount[0].attemptCount = "1";
const stringAttemptReport = m22A6BuildSoakReportV1({ ...validEvidence, missions: stringAttemptCount });
assert.equal(stringAttemptReport.status, "BLOCKED");
assert.ok(stringAttemptReport.blockers.includes("mission_0_attempt_count_out_of_bounds"));

const liveWorker = read("cloudflare-autonomy/worker.mjs");
assert.match(liveWorker, /export const MISSION_EXECUTION_PAUSED = true;/,
  "A6 preparation must preserve the global mission freeze");
assert.doesNotMatch(liveWorker, /MISSION_EXECUTION_PAUSED\s*=\s*false/,
  "A6 must never silently lift the global freeze");

const a6PreparationPaths = [
  "autonomy/mission-wonder-2-a6-soak-v1.mjs",
  "autonomy/MISSION_WONDER_2_STEP6_A6_SOAK.md",
  "tests/mission-wonder-2-step6-a6-soak.test.mjs",
];
const supabaseDeployFilter = read(".github/workflows/supabase-canonical-deploy.yml");
const cloudflareDeployFilter = read(".github/workflows/aria-cloudflare-deploy.yml");
const pwaDeployFilter = read(".github/workflows/aria-pwa-fast-deploy.yml");
for (const path of a6PreparationPaths) {
  assert.ok(supabaseDeployFilter.includes("'!" + path + "'"),
    "A6 preparation path must be excluded from Supabase production deploy: " + path);
  assert.ok(cloudflareDeployFilter.includes("'" + path + "'"),
    "A6 preparation path must be excluded from Cloudflare production deploy: " + path);
  assert.ok(pwaDeployFilter.includes("'" + path + "'"),
    "A6 preparation path must be excluded from PWA production deploy: " + path);
}

const packageJson = JSON.parse(read("package.json"));
assert.ok(packageJson.scripts.test.includes("tests/mission-wonder-2-step6-a6-soak.test.mjs"),
  "the A6 soak evaluator contract must run in npm test");

console.log("MISSION_WONDER_2_STEP6_A6_SOAK_EVALUATOR=PASS");
console.log("MISSION_WONDER_2_STEP6_A6_FREEZE_PRESERVED=PASS");
