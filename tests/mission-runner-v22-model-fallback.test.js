const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const source = fs.readFileSync(file, "utf8");

const required = [
  "verifiedModelFallbackRoutes",
  // Primary may be openrouter OR google; fallback must still fire for google unauthorized.
  '!["openrouter", "google", "mistral", "xai", "local_windows"].includes(primaryProvider)',
  'risk !== "READ"',
  '.in("provider_id", ["openrouter", "google"])',
  'providerId === "google" && !modelId.endsWith("-direct")',
  'providerId === "openrouter" && !modelId.endsWith(":free")',
  'Array.isArray(a.models)',
  'a.models.includes(modelId)',
  '_provider_priority: providerId === primaryProvider ? 1 : 0',
  "_provider_priority",
  "model_fallback_used",
  "model_execution_failures",
  "LOCAL_DEVICE_HEARTBEAT_FRESHNESS_MS = 3 * 60_000",
  "function isFreshDeviceHeartbeat(lastSeenAt: unknown",
  "isFreshDeviceHeartbeat(d?.last_seen_at)",
  "isFreshDeviceHeartbeat(device?.last_seen_at)",
  "model_execution_failures: Array.isArray(result?.model_execution_failures)",
  "provider_status: failure?.provider_status == null ? null : String(failure.provider_status)",
  'requiredConnectorOperations = ["cuevacoin_connection_status", "cuevacoin_project_control"]',
  "missingRequiredConnectorOperations",
  "required_tool_call_evidence_missing:",
  'status: reason.startsWith("planner_empty_steps") || requiredToolEvidenceMissing ? "blocked" : "paused"',
  '"human_gate:enable_authorized_required_connector_operations"',
];

for (const fragment of required) {
  if (!source.includes(fragment)) {
    throw new Error("missing mission runner model fallback contract: " + fragment);
  }
}

console.log("mission-runner-v22 model fallback multi-provider contract: PASS");

if (!source.includes('executorType(step) === "connector"') || !source.includes('result?.data !== null')) {
  throw new Error("named tool success must be backed by a connector execution result");
}
console.log("mission runner required connector evidence anti-false-success contract: PASS");
