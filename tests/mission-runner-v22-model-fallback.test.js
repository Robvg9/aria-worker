const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const source = fs.readFileSync(file, "utf8");

const required = [
  "verifiedModelFallbackRoutes",
  'String(original?.provider_id || "") !== "openrouter"',
  'risk !== "READ"',
  'String(model.status) !== "available"',
  '!modelId.endsWith(":free")',
  'String(x.status) === "verified"',
  'out.slice(0,4)',
  "model_fallback_used",
  "model_execution_failures",
];

for (const fragment of required) {
  if (!source.includes(fragment)) {
    throw new Error("missing mission runner model fallback contract: " + fragment);
  }
}

console.log("mission-runner-v22 model fallback contract: PASS");
