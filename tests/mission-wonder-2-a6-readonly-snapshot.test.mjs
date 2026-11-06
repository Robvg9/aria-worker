import assert from "node:assert/strict";
import {
  A6_PROJECT_HOST,
  fetchA6AmbientSnapshot,
  validateA6AmbientSnapshot,
} from "../scripts/mission-wonder-2-a6-readonly-snapshot.mjs";

const scopeId = "mission_wonder_2_a6_run_20261106";
const raw = {
  schemaVersion: "mission-wonder-2-a6-ambient-snapshot-v1",
  scopeId,
  snapshotAt: "2026-11-06T15:00:00.000Z",
  legacyNonterminalMissionCount: 291,
  legacyNonterminalMissionFingerprint: "713960e84a7ec49b55fc765ef627e8ff",
  nonA6ActiveJobCount: 0,
  nonA6ActiveJobFingerprint: "d41d8cd98f00b204e9800998ecf8427e",
  cron48Active: false,
  cron49Active: false,
  cron50Active: false,
  activeA6MissionCount: 0,
  activeA6JobCount: 0,
  missionExecutionPaused: "NOT_VERIFIED_BY_DATABASE",
};

const normalized = validateA6AmbientSnapshot(raw, scopeId);
assert.equal(normalized.legacyNonterminalMissionCount, 291);
assert.equal(normalized.nonA6ActiveJobCount, 0);
assert.equal(normalized.missionExecutionPaused, null);
assert.equal(normalized.freezeEvidence, "NOT_VERIFIED_BY_DATABASE");
assert.equal(normalized.cron48Active, false);

assert.throws(() => validateA6AmbientSnapshot({ ...raw, scopeId: "a5" }, scopeId),
  /scope_or_version_mismatch/);
assert.throws(() => validateA6AmbientSnapshot({ ...raw, legacyNonterminalMissionCount: "291" }, scopeId),
  /count_invalid/);
assert.throws(() => validateA6AmbientSnapshot({ ...raw, legacyNonterminalMissionFingerprint: "bad" }, scopeId),
  /fingerprint_invalid/);
assert.throws(() => validateA6AmbientSnapshot({ ...raw, cron49Active: null }, scopeId),
  /cron_unmeasured/);
assert.throws(() => validateA6AmbientSnapshot({ ...raw, missionExecutionPaused: true }, scopeId),
  /must_not_claim_to_verify_global_freeze/);

let request;
const snapshot = await fetchA6AmbientSnapshot({
  supabaseUrl: "https://" + A6_PROJECT_HOST,
  serviceRoleKey: "x".repeat(40),
  scopeId,
  fetchImpl: async (url, init) => {
    request = { url: String(url), init };
    return { ok: true, status: 200, json: async () => raw };
  },
});
assert.equal(snapshot.missionExecutionPaused, null);
assert.equal(request.init.method, "POST");
assert.equal(request.init.redirect, "error");
assert.equal(request.url, "https://" + A6_PROJECT_HOST + "/rest/v1/rpc/aria_m22_a6_ambient_snapshot_v1");
assert.deepEqual(JSON.parse(request.init.body), { p_scope_id: scopeId });
assert.equal(request.init.headers.apikey, "x".repeat(40));
assert.equal(request.init.headers.authorization, "Bearer " + "x".repeat(40));

await assert.rejects(() => fetchA6AmbientSnapshot({
  supabaseUrl: "https://example.com",
  serviceRoleKey: "x".repeat(40),
  scopeId,
  fetchImpl: async () => { throw new Error("must_not_call"); },
}), /origin_not_allowlisted/);
await assert.rejects(() => fetchA6AmbientSnapshot({
  supabaseUrl: "https://" + A6_PROJECT_HOST,
  serviceRoleKey: "short",
  scopeId,
  fetchImpl: async () => { throw new Error("must_not_call"); },
}), /service_role_key_missing_or_invalid/);
await assert.rejects(() => fetchA6AmbientSnapshot({
  supabaseUrl: "https://" + A6_PROJECT_HOST,
  serviceRoleKey: "x".repeat(40),
  scopeId: "mission_wonder_2_a5_authorized_once",
  fetchImpl: async () => { throw new Error("must_not_call"); },
}), /scope_id_invalid/);

console.log("MISSION_WONDER_2_A6_READONLY_SNAPSHOT_CLIENT=PASS");
console.log("MISSION_WONDER_2_A6_DATABASE_FREEZE_CLAIM_REJECTED=PASS");
