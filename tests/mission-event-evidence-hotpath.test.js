const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "supabase", "migrations", "20260920024000_mission_event_evidence_hotpath_v1.sql");
const source = fs.readFileSync(file, "utf8");
for (const fragment of [
  "if new.event_type <> 'mission_verified' then",
  "perform aria_evidence.record_claim",
  "exception when others then",
  "return new;"
]) {
  if (!source.includes(fragment)) throw new Error("missing evidence hot-path hardening contract: " + fragment);
}
console.log("mission event evidence hot-path contract: PASS");
