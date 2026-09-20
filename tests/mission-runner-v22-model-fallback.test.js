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
