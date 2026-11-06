const HOUR_MS = 60 * 60 * 1000;

export const M22_A6_FAULT_SCENARIOS_V1 = Object.freeze([
  "host_restart",
  "provider_degraded",
  "executor_offline",
  "timeout",
  "rate_limit",
]);

export const M22_A6_SOAK_WINDOWS_V1 = Object.freeze({
  initial_hours: 24,
  reinforced_hours: 72,
  proposed_minimum_missions_per_24h: 5,
  proposed_minimum_missions_per_72h: 15,
});

function timestampMs(value) {
  const result = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(result) ? result : null;
}

function numericValues(values, label, blockers, { allowZero = false } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    blockers.push(label + "_samples_missing");
    return [];
  }
  const normalized = values.map(Number);
  if (normalized.some(value => !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))) {
    blockers.push(label + "_sample_invalid");
    return [];
  }
  return normalized;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function unique(values) {
  return new Set(values).size === values.length;
}

/**
 * Evaluate an A6 evidence bundle. This function is deliberately pure: it never
 * contacts a provider, creates missions/jobs, mutates runtime state, or changes
 * the global execution freeze.
 *
 * A PASS means the supplied evidence meets the thresholds declared by the
 * caller. It does not certify that evidence is live or independently authentic.
 */
export function m22A6BuildSoakReportV1(input = {}) {
  const blockers = [];
  const thresholds = input.thresholds && typeof input.thresholds === "object" ? input.thresholds : {};
  const startedAt = timestampMs(input.startedAt);
  const finishedAt = timestampMs(input.finishedAt);
  if (startedAt === null || finishedAt === null || finishedAt <= startedAt) {
    blockers.push("soak_window_invalid");
  }
  const elapsedMs = startedAt !== null && finishedAt !== null && finishedAt > startedAt
    ? finishedAt - startedAt : 0;

  const minimumDurationHours = Number(thresholds.minimumDurationHours);
  if (![24, 72].includes(minimumDurationHours)) blockers.push("threshold_minimum_duration_must_be_24_or_72_hours");
  if (elapsedMs < minimumDurationHours * HOUR_MS) blockers.push("soak_duration_below_declared_minimum");

  const minimumMissions = Number(thresholds.minimumMissions);
  const proposedMissionFloor = minimumDurationHours === 72 ? 15 : 5;
  if (!Number.isSafeInteger(minimumMissions) || minimumMissions < proposedMissionFloor) blockers.push("threshold_minimum_missions_invalid");

  const heartbeatIntervalMs = Number(thresholds.heartbeatIntervalMs);
  const maxNormalHeartbeatGapMs = Number(thresholds.maxNormalHeartbeatGapMs);
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0 ||
      !Number.isFinite(maxNormalHeartbeatGapMs) || maxNormalHeartbeatGapMs < heartbeatIntervalMs) {
    blockers.push("heartbeat_thresholds_invalid");
  } else if (maxNormalHeartbeatGapMs > heartbeatIntervalMs * 3) {
    blockers.push("heartbeat_threshold_exceeds_three_intervals");
  }

  const maxRecoveryMs = Number(thresholds.maxRecoveryMs);
  const maxP95LatencyMs = Number(thresholds.maxP95LatencyMs);
  const maxTotalCostUsd = Number(thresholds.maxTotalCostUsd);
  const maxAttemptsPerJob = Number(thresholds.maxAttemptsPerJob);
  const maxBacklogAgeMs = Number(thresholds.maxBacklogAgeMs);
  if (!Number.isFinite(maxRecoveryMs) || maxRecoveryMs <= 0) blockers.push("threshold_max_recovery_ms_required");
  if (!Number.isFinite(maxP95LatencyMs) || maxP95LatencyMs <= 0) blockers.push("threshold_max_p95_latency_ms_required");
  if (!Number.isFinite(maxTotalCostUsd) || maxTotalCostUsd < 0) blockers.push("threshold_max_total_cost_usd_required");
  if (!Number.isSafeInteger(maxAttemptsPerJob) || maxAttemptsPerJob < 1 || maxAttemptsPerJob > 3) {
    blockers.push("threshold_max_attempts_must_be_1_to_3");
  }
  if (!Number.isFinite(maxBacklogAgeMs) || maxBacklogAgeMs < 0) blockers.push("threshold_max_backlog_age_ms_required");

  const missions = Array.isArray(input.missions) ? input.missions : [];
  if (missions.length < (Number.isSafeInteger(minimumMissions) ? minimumMissions : 5)) blockers.push("mission_volume_below_declared_minimum");
  const missionIds = missions.map(item => String(item && item.missionId || ""));
  const jobIds = missions.map(item => String(item && item.jobId || ""));
  const verificationEventIds = missions.map(item => String(item && item.verificationEventId || ""));
  const artifactHashes = missions.flatMap(item => Array.isArray(item && item.artifactSha256) ? item.artifactSha256 : []);
  const validArtifactHashes = artifactHashes.filter(value => /^[a-f0-9]{64}$/i.test(String(value)));
  if (missionIds.some(value => !value) || !unique(missionIds)) blockers.push("mission_ids_missing_or_duplicated");
  if (jobIds.some(value => !value) || !unique(jobIds)) blockers.push("job_ids_missing_or_duplicated");
  if (verificationEventIds.some(value => !value) || !unique(verificationEventIds)) blockers.push("verification_event_ids_missing_or_duplicated");
  if (artifactHashes.some(value => !/^[a-f0-9]{64}$/i.test(String(value))) || !unique(artifactHashes)) {
    blockers.push("artifact_hashes_missing_invalid_or_duplicated");
  }
  for (const [index, mission] of missions.entries()) {
    if (!mission || mission.status !== "succeeded" || mission.objectiveVerified !== true) {
      blockers.push("mission_" + index + "_not_independently_verified_success");
    }
    if (Number(mission && mission.verificationEventCount) !== 1) {
      blockers.push("mission_" + index + "_verification_event_count_not_one");
    }
    const attempts = Number(mission && mission.attemptCount);
    if (!Number.isSafeInteger(attempts) || attempts < 1 ||
        (Number.isSafeInteger(maxAttemptsPerJob) && attempts > maxAttemptsPerJob)) {
      blockers.push("mission_" + index + "_attempt_count_out_of_bounds");
    }
    if (!mission || mission.activeAtEnd !== false) blockers.push("mission_" + index + "_active_state_missing_or_not_false");
    if (!mission || !Number.isSafeInteger(mission.duplicateCount) || mission.duplicateCount !== 0) {
      blockers.push("mission_" + index + "_duplicate_count_missing_or_nonzero");
    }
    if (!mission || !Array.isArray(mission.artifactSha256) || mission.artifactSha256.length !== 1 ||
        !/^[a-f0-9]{64}$/i.test(String(mission.artifactSha256[0] || ""))) {
      blockers.push("mission_" + index + "_must_have_exactly_one_valid_artifact_hash");
    }
  }

  const heartbeatGaps = Array.isArray(input.heartbeatGaps) ? input.heartbeatGaps : [];
  if (!heartbeatGaps.length) blockers.push("heartbeat_gap_evidence_missing");
  const normalGaps = [];
  const outageGaps = [];
  for (const [index, gap] of heartbeatGaps.entries()) {
    const gapMs = Number(gap && gap.gapMs);
    if (!Number.isFinite(gapMs) || gapMs < 0) {
      blockers.push("heartbeat_gap_" + index + "_invalid");
      continue;
    }
    if (gap && gap.expectedOutage === true) {
      outageGaps.push(gapMs);
      if (gap.recovered !== true || (Number.isFinite(maxRecoveryMs) && gapMs > maxRecoveryMs)) {
        blockers.push("heartbeat_outage_" + index + "_not_recovered_within_threshold");
      }
    } else {
      normalGaps.push(gapMs);
      if (Number.isFinite(maxNormalHeartbeatGapMs) && gapMs > maxNormalHeartbeatGapMs) {
        blockers.push("heartbeat_gap_" + index + "_exceeded_threshold");
      }
    }
  }

  const faultScenarios = Array.isArray(input.faultScenarios) ? input.faultScenarios : [];
  for (const required of M22_A6_FAULT_SCENARIOS_V1) {
    const matches = faultScenarios.filter(item => item && item.name === required);
    if (matches.length !== 1 || matches[0].injected !== true || matches[0].detected !== true ||
        matches[0].recovered !== true ||
        !Number.isFinite(Number(matches[0].recoveryMs)) ||
        (Number.isFinite(maxRecoveryMs) && Number(matches[0].recoveryMs) > maxRecoveryMs)) {
      blockers.push("fault_scenario_" + required + "_not_proven");
    }
  }
  if (faultScenarios.some(item => !item || !M22_A6_FAULT_SCENARIOS_V1.includes(item.name))) {
    blockers.push("unexpected_fault_scenario");
  }

  const latencySamples = numericValues(input.latencySamplesMs, "latency", blockers);
  const costSamples = numericValues(input.costSamplesUsd, "cost", blockers, { allowZero: true });
  const p95LatencyMs = percentile(latencySamples, 0.95);
  const totalCostUsd = costSamples.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(maxP95LatencyMs) && p95LatencyMs !== null && p95LatencyMs > maxP95LatencyMs) {
    blockers.push("p95_latency_exceeded_threshold");
  }
  if (Number.isFinite(maxTotalCostUsd) && totalCostUsd > maxTotalCostUsd) {
    blockers.push("total_cost_exceeded_threshold");
  }

  const backlogSamples = Array.isArray(input.backlogSamples) ? input.backlogSamples : [];
  if (!backlogSamples.length) {
    blockers.push("backlog_evidence_missing");
  } else {
    const finalBacklog = backlogSamples[backlogSamples.length - 1];
    const pendingJobs = Number(finalBacklog && finalBacklog.pendingJobs);
    const oldestPendingAgeMs = Number(finalBacklog && finalBacklog.oldestPendingAgeMs);
    if (pendingJobs !== 0) blockers.push("backlog_not_drained_at_end");
    if (!Number.isFinite(oldestPendingAgeMs) || oldestPendingAgeMs > maxBacklogAgeMs) {
      blockers.push("backlog_oldest_age_exceeded_threshold");
    }
  }

  const orphanJobs = Number(input.orphanJobs);
  if (!Number.isSafeInteger(orphanJobs) || orphanJobs !== 0) blockers.push("orphan_jobs_present_or_unmeasured");

  return {
    schemaVersion: "mission-wonder-2-a6-soak-v1",
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: [...new Set(blockers)],
    evidenceClassification: "UNATTESTED_INPUT",
    liveAttestation: "NOT_CHECKED_BY_PURE_EVALUATOR",
    metrics: {
      elapsedHours: elapsedMs / HOUR_MS,
      missionCount: missions.length,
      independentlyVerifiedMissionCount: missions.filter(item => item && item.status === "succeeded" && item.objectiveVerified === true).length,
      uniqueJobCount: unique(jobIds.filter(Boolean)) ? new Set(jobIds.filter(Boolean)).size : null,
      uniqueArtifactHashCount: unique(validArtifactHashes) ? new Set(validArtifactHashes).size : null,
      normalHeartbeatGapMaxMs: normalGaps.length ? Math.max(...normalGaps) : null,
      expectedOutageGapMaxMs: outageGaps.length ? Math.max(...outageGaps) : null,
      latencyP50Ms: percentile(latencySamples, 0.50),
      latencyP95Ms: p95LatencyMs,
      totalCostUsd,
      averageCostPerMissionUsd: missions.length ? totalCostUsd / missions.length : null,
      faultScenariosRecovered: faultScenarios.filter(item => item && item.recovered === true).length,
      finalPendingJobs: backlogSamples.length ? Number(backlogSamples[backlogSamples.length - 1].pendingJobs) : null,
      orphanJobs: Number.isSafeInteger(orphanJobs) ? orphanJobs : null,
    },
  };
}

export { HOUR_MS as M22_A6_HOUR_MS };
