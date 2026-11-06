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
const validEvidence = {
  startedAt: hours(0),
  finishedAt: hours(24),
  evidenceClassification: "SIMULATED",
  thresholds,
  missions,
  heartbeatGaps: [
    { gapMs: 5000, expectedOutage: false },
    { gapMs: 10000, expectedOutage: false },
    { gapMs: 45000, expectedOutage: true, recovered: true },
  ],
  faultScenarios,
  latencySamplesMs: [900, 1200, 1500, 2400, 3000, 4200, 5800, 7000, 8500, 12000],
  costSamplesUsd: [0.001, 0.001, 0.001, 0.001, 0.001],
  backlogSamples: [
    { pendingJobs: 2, oldestPendingAgeMs: 1000 },
    { pendingJobs: 0, oldestPendingAgeMs: 0 },
  ],
  orphanJobs: 0,
};

const report = m22A6BuildSoakReportV1(validEvidence);
assert.equal(report.status, "PASS");
assert.deepEqual(report.blockers, []);
assert.equal(report.evidenceClassification, "SIMULATED_OR_UNCLASSIFIED");
assert.equal(report.metrics.elapsedHours, 24);
assert.equal(report.metrics.missionCount, 5);
assert.equal(report.metrics.independentlyVerifiedMissionCount, 5);
assert.equal(report.metrics.uniqueJobCount, 5);
assert.equal(report.metrics.faultScenariosRecovered, 5);
assert.equal(report.metrics.finalPendingJobs, 0);
assert.equal(report.metrics.orphanJobs, 0);
assert.equal(report.metrics.totalCostUsd, 0.005);
assert.equal(M22_A6_SOAK_WINDOWS_V1.initial_hours, 24);
assert.equal(M22_A6_SOAK_WINDOWS_V1.reinforced_hours, 72);
assert.equal(M22_A6_SOAK_WINDOWS_V1.proposed_minimum_missions_per_24h, 5);
assert.equal(M22_A6_SOAK_WINDOWS_V1.proposed_minimum_missions_per_72h, 15);

const liveReport = m22A6BuildSoakReportV1({ ...validEvidence, evidenceClassification: "LIVE" });
assert.equal(liveReport.evidenceClassification, "LIVE");

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
  heartbeatGaps: [{ gapMs: 180000, expectedOutage: true, recovered: false }],
});
assert.equal(outageFailure.status, "BLOCKED");
assert.ok(outageFailure.blockers.includes("heartbeat_outage_0_not_recovered_within_threshold"));

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
assert.ok(backlogFailure.blockers.includes("backlog_oldest_age_exceeded_threshold"));

const orphanFailure = m22A6BuildSoakReportV1({ ...validEvidence, orphanJobs: 1 });
assert.equal(orphanFailure.status, "BLOCKED");
assert.ok(orphanFailure.blockers.includes("orphan_jobs_present_or_unmeasured"));

const liveWorker = read("cloudflare-autonomy/worker.mjs");
assert.match(liveWorker, /export const MISSION_EXECUTION_PAUSED = true;/,
  "A6 preparation must preserve the global mission freeze");
assert.doesNotMatch(liveWorker, /MISSION_EXECUTION_PAUSED\s*=\s*false/,
  "A6 must never silently lift the global freeze");

const packageJson = JSON.parse(read("package.json"));
assert.ok(packageJson.scripts.test.includes("tests/mission-wonder-2-step6-a6-soak.test.mjs"),
  "the A6 soak evaluator contract must run in npm test");

console.log("MISSION_WONDER_2_STEP6_A6_SOAK_EVALUATOR=PASS");
console.log("MISSION_WONDER_2_STEP6_A6_FREEZE_PRESERVED=PASS");
