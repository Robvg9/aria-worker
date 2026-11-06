import process from "node:process";

export const A6_PROJECT_HOST = "icuqsstxfdbvjytkhlog.supabase.co";
const SCOPE_ID_PATTERN = /^mission_wonder_2_a6_[a-z0-9_-]{6,100}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{32}$/i;

export function validateA6AmbientSnapshot(value, expectedScopeId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("a6_ambient_snapshot_invalid_payload");
  }
  if (!SCOPE_ID_PATTERN.test(String(expectedScopeId || "")) ||
      value.scopeId !== expectedScopeId ||
      value.schemaVersion !== "mission-wonder-2-a6-ambient-snapshot-v1") {
    throw new Error("a6_ambient_snapshot_scope_or_version_mismatch");
  }
  const countFields = [
    "legacyNonterminalMissionCount",
    "nonA6ActiveJobCount",
    "activeA6MissionCount",
    "activeA6JobCount",
  ];
  for (const field of countFields) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error("a6_ambient_snapshot_count_invalid:" + field);
    }
  }
  for (const field of ["legacyNonterminalMissionFingerprint", "nonA6ActiveJobFingerprint"]) {
    if (typeof value[field] !== "string" || !FINGERPRINT_PATTERN.test(value[field])) {
      throw new Error("a6_ambient_snapshot_fingerprint_invalid:" + field);
    }
  }
  const observedAt = Date.parse(String(value.snapshotAt || ""));
  if (!Number.isFinite(observedAt)) throw new Error("a6_ambient_snapshot_timestamp_invalid");
  for (const field of ["cron48Active", "cron49Active", "cron50Active"]) {
    if (typeof value[field] !== "boolean") {
      throw new Error("a6_ambient_snapshot_cron_unmeasured:" + field);
    }
  }
  if (value.missionExecutionPaused !== "NOT_VERIFIED_BY_DATABASE") {
    throw new Error("a6_database_must_not_claim_to_verify_global_freeze");
  }

  return {
    legacyNonterminalMissionCount: value.legacyNonterminalMissionCount,
    legacyNonterminalMissionFingerprint: value.legacyNonterminalMissionFingerprint.toLowerCase(),
    nonA6ActiveJobCount: value.nonA6ActiveJobCount,
    nonA6ActiveJobFingerprint: value.nonA6ActiveJobFingerprint.toLowerCase(),
    cron48Active: value.cron48Active,
    cron49Active: value.cron49Active,
    cron50Active: value.cron50Active,
    // Deliberately null: a separate LIVE HTTP-423/source check must supply true.
    missionExecutionPaused: null,
    freezeEvidence: "NOT_VERIFIED_BY_DATABASE",
    activeA6MissionCount: value.activeA6MissionCount,
    activeA6JobCount: value.activeA6JobCount,
    snapshotAt: new Date(observedAt).toISOString(),
  };
}

export async function fetchA6AmbientSnapshot({
  supabaseUrl,
  serviceRoleKey,
  scopeId,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const base = new URL(String(supabaseUrl || ""));
  if (base.protocol !== "https:" || base.hostname !== A6_PROJECT_HOST ||
      base.username || base.password || base.port) {
    throw new Error("a6_supabase_project_origin_not_allowlisted");
  }
  if (!serviceRoleKey || typeof serviceRoleKey !== "string" || serviceRoleKey.length < 32) {
    throw new Error("a6_service_role_key_missing_or_invalid");
  }
  if (!SCOPE_ID_PATTERN.test(String(scopeId || ""))) {
    throw new Error("a6_scope_id_invalid");
  }

  const endpoint = new URL("/rest/v1/rpc/aria_m22_a6_ambient_snapshot_v1", base);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: "Bearer " + serviceRoleKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ p_scope_id: scopeId }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error("a6_ambient_snapshot_rpc_http_" + response.status);
  }
  const payload = await response.json();
  return validateA6AmbientSnapshot(payload, scopeId);
}

async function main() {
  const snapshot = await fetchA6AmbientSnapshot({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    scopeId: process.env.A6_SCOPE_ID,
  });
  process.stdout.write(JSON.stringify(snapshot) + "\n");
  process.stdout.write("MISSION_WONDER_2_A6_AMBIENT_SNAPSHOT_READONLY=PASS\n");
  process.stdout.write("MISSION_WONDER_2_A6_GLOBAL_FREEZE_NOT_ATTESTED_BY_DATABASE=PASS\n");
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(String(error && error.message || error).replace(/[\r\n]/g, " ") + "\n");
    process.exitCode = 1;
  });
}
