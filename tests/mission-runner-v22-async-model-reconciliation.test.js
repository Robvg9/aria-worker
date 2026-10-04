const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const source = fs.readFileSync(file, "utf8");

const required = [
  "if (localResult?.status === \"waiting\")",
  "pending_source: \"windows_ollama\"",
  "const pendingJobId = typeof pending?.job_id === \"string\"",
  "let reconciledPendingResult: any = null;",
  "pending_reconciled: true",
  "const pendingSource = String(waiting.result?.pending_source || \"\");",
  "status: \"waiting\"",
  "resume: pending local Qwen job ",
];

for (const fragment of required) {
  if (!source.includes(fragment)) throw new Error("missing async mission reconciliation contract: " + fragment);
}

const pendingGuard = source.indexOf("const pendingJobId = typeof pending?.job_id");
const oldDeviceOnly = 'executorType(step) === "device" && typeof pending?.job_id === "string"';
if (pendingGuard < 0 || source.includes(oldDeviceOnly)) {
  throw new Error("pending-job reconciliation still depends on planner executor type");
}

const reconcileBlock = source.indexOf("let reconciledPendingResult: any = null;");
const executeBlock = source.indexOf("result = await executeStep", reconcileBlock);
if (reconcileBlock < 0 || executeBlock < 0 || source.indexOf("if (!reconciledPendingResult)", reconcileBlock) < 0) {
  throw new Error("terminal async job is not reconciled before executeStep");
}

console.log("mission-runner-v22 async local model job reconciliation contract: PASS");
