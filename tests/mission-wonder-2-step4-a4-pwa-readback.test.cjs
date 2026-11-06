const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts/mission-wonder-2-step4-a4-pwa-readback.mjs"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/mission-wonder-2-step4-a4-pwa-readback.yml"), "utf8");

for (const marker of [
  "mission_a4_authorized_once",
  "39a8f5fd-18e6-4bba-bdd3-31691ec18f3e",
  "grant_type=password",
  "RWHT_EMAIL",
  "RWHT_PASSWORD",
  "/api/missions/",
  "/api/meditation/notifications?limit=50",
  "mission_completed_verified",
  "status === \"succeeded\"",
  "completed_steps",
  "total_steps",
  "read_only: true",
  "A4_AUTHENTICATED_PWA_MISSION_AND_NOTIFICATION_READBACK_PASS",
]) assert.ok(script.includes(marker), "PWA readback must validate " + marker);

assert.doesNotMatch(script, /runner_tick_for_mission|claim_runner_handoff|claim_recovery_tick|functions\/v1\/aria-canonical-runtime-v1|INSERT INTO|UPDATE aria_internal|DELETE FROM/i,
  "PWA readback is strictly read-only and may not resume or mutate any mission/job/scope");
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
assert.match(workflow, /RWHT_EMAIL/);
assert.match(workflow, /RWHT_PASSWORD/);
assert.match(workflow, /node scripts\/mission-wonder-2-step4-a4-pwa-readback\.mjs/);
assert.doesNotMatch(workflow, /schedule:|push:|workflow_run:/);

console.log("mission-wonder-2-step4-a4-pwa-readback contract: PASS");
