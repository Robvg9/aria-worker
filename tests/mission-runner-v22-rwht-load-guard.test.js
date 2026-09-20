const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const source = fs.readFileSync(file, "utf8");

const required = [
  "verifiedModelFallbackRoutes",
  'String(original?.provider_id || "") !== "openrouter"',
  'risk !== "READ"',
  'provider_id, "google"',
  'providerId === "google" && !modelId.endsWith("-direct")',
  'providerId === "openrouter" && !modelId.endsWith(":free")',
  'Array.isArray(a.models)',
  'x.models.includes(modelId)',
  "_provider_priority",
  "model_fallback_used",
  "model_execution_failures",
];

for (const fragment of required) {
  if (!source.includes(fragment)) {
    throw new Error("missing mission runner model fallback contract: " + fragment);
  }
}

console.log("mission-runner-v22 model fallback multi-provider contract: PASS");
const runnerPath = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const runnerSource = fs.readFileSync(runnerPath, "utf8");

const guardRequired = [
  'request.headers.get("x-aria-trigger") === "rwht-exclusive"',
  'if (rwhtExclusive && requestedMissionId !== rwhtGuardMission)',
  'temporary_rwht_exclusive_run',
];
for (const fragment of guardRequired) {
  if (!runnerSource.includes(fragment)) {
    throw new Error("missing RWHT load-guard scope contract: " + fragment);
  }
}
if (runnerSource.includes('if (requestedMissionId !== rwhtGuardMission) {')) {
  throw new Error("RWHT load guard must not globally block every mission ID");
}

console.log("mission-runner-v22 RWHT load-guard scope contract: PASS");
