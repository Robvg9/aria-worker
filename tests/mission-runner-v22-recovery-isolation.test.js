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


// RWHT must honor the governed Android-specific UI capability without weakening
// the autonomous Computer Use requirement for desktop or non-Android devices.
const rwhtGuardStart = s.indexOf("function objectivePlanAlignment");
const rwhtGuardEnd = s.indexOf("function evidenceBoundSynthesisVerification", rwhtGuardStart);
if (rwhtGuardStart < 0 || rwhtGuardEnd < 0) {
  throw new Error("missing mission runner objective-plan alignment guard");
}
const rwhtGuard = s.slice(rwhtGuardStart, rwhtGuardEnd);
for (const marker of [
  "const hasAndroidUi=(steps||[]).some((step:any)=>",
  "operation==='computer.use.android'",
  "deviceId.startsWith('android-termux-')",
  "if(isRwht && !hasAutonomous && !hasAndroidUi)",
  "executorType(step)==='device'",
]) {
  if (!rwhtGuard.includes(marker)) {
    throw new Error("missing Android-scoped RWHT capability contract: " + marker);
  }
}
console.log("mission-runner-v22 Android-specific RWHT capability contract: PASS");


// Quota/payment failures are terminal for the blocked provider/account:
// model routing may continue only to a different verified provider/account,
// and agent fallback must not repeatedly traverse the same blocked service.
const quotaGuardStart = s.indexOf("function isProviderQuotaBlocked");
const quotaGuardEnd = s.indexOf("const AGENT_RECOVERY_FALLBACKS", quotaGuardStart);
if (quotaGuardStart < 0 || quotaGuardEnd < 0) {
  throw new Error("missing provider quota circuit-breaker helper");
}
const quotaGuard = s.slice(quotaGuardStart, quotaGuardEnd);
for (const marker of [
  "status === 402",
  "http === 402",
  "quota",
  "payment",
  "insufficient",
]) {
  if (!quotaGuard.includes(marker)) {
    throw new Error("provider quota circuit breaker missing marker: " + marker);
  }
}

const modelExecuteStart = s.indexOf("async function modelExecute(");
const agentExecuteStart = s.indexOf("async function agentExecute(", modelExecuteStart);
if (modelExecuteStart < 0 || agentExecuteStart < 0) {
  throw new Error("missing canonical model/agent execution functions");
}
const modelExecute = s.slice(modelExecuteStart, agentExecuteStart);
for (const marker of [
  "const blockedProviderAccounts = new Set<string>()",
  "blockedProviderAccounts.has(routeAccountKey)",
  "isProviderQuotaBlocked(response.status, err.provider_status, err.code, err.message)",
  "blockedProviderAccounts.add(routeAccountKey)",
]) {
  if (!modelExecute.includes(marker)) {
    throw new Error("model quota circuit-breaker missing marker: " + marker);
  }
}

const agentExecuteEnd = s.indexOf("async function easGraphQL(", agentExecuteStart);
const agentExecute = s.slice(agentExecuteStart, agentExecuteEnd);
const quotaHardStop = agentExecute.indexOf("provider_quota_blocked");
const fallbackAttempt = agentExecute.indexOf("const fallback = AGENT_RECOVERY_FALLBACKS[agentId]");
if (quotaHardStop < 0 || fallbackAttempt < 0 || quotaHardStop > fallbackAttempt) {
  throw new Error("agent quota failures must stop before attempting another agent fallback");
}
console.log("provider quota/payment circuit-breaker contract: PASS");
