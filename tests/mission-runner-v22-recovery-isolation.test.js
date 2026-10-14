const fs=require("fs");const p=require("path");const s=fs.readFileSync(p.join(__dirname,"..","supabase/functions/aria-mission-runner-v22/index.ts"),"utf8");
const cuevacoinPermissionGate = s.slice(
  s.indexOf("const cuevacoinActionsPermissionBlocked ="),
  s.indexOf("// One governed escape hatch:", s.indexOf("const cuevacoinActionsPermissionBlocked ="))
);
for (const marker of [
  'failedStepId === "cuevacoin_deploy_dispatch"',
  'originalGoal.toLowerCase().includes("cuevacoin")',
  'originalGoal.includes("cuevacoin-deploy.yml")',
  'github_app_permission_denied',
  'mission_hard_blocked',
  'status: "blocked"',
  'lease_owner: null',
  'Actions Read and write',
]) {
  if (!cuevacoinPermissionGate.includes(marker)) throw new Error("missing CuevaCoin permission hard-stop marker: " + marker);
}
console.log("CuevaCoin GitHub Actions permission hard-stop contract: PASS");

for(const x of ["staleRecovery","schema cache|retrying|statement timeout|timeout","throw recoveryError"]){if(!s.includes(x))throw new Error("missing recovery isolation contract: "+x)}console.log("recovery isolation contract: PASS");
if(!s.includes('governed_existing_sandbox_recovery'))throw new Error('missing BattleCruiser sandbox recovery verification');
if(!s.includes('recovered_existing_branch===true'))throw new Error('missing existing sandbox branch evidence guard');
console.log("BattleCruiser sandbox recovery contract: PASS");

const path = require("node:path");
const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20261013223000_paused_pending_job_recovery_cap_v1.sql"),
  "utf8"
);
if (!migration.includes("coalesce(m.recovery_count,0) < 3")) {
  throw new Error("paused pending-job recovery must stop at three claims");
}
if (!migration.includes("coalesce(m.recovery_count,0) >= 3")) {
  throw new Error("migration must reconcile already-exhausted loops");
}
if (!migration.includes("ej.status NOT IN ('succeeded','failed','timeout','cancelled')")) {
  throw new Error("only terminal execution jobs may be included in automatic loop cleanup");
}
if (!migration.includes("paused_pending_job_retry_cap_exceeded")) {
  throw new Error("exhausted pending-job loop needs an actionable persisted diagnostic");
}
if (!migration.includes("status = 'blocked'")) {
  throw new Error("exhausted terminal pending-job missions must fail closed, not stay silently paused");
}
console.log("paused pending-job reclaim cap contract: PASS");
