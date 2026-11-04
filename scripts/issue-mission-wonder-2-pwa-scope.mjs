import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const purpose = "mission_wonder_2_step3_pwa_scoped_mission_v1";
const operations = [
  "repo_read", "tree_read", "file_read", "ref_read",
  "pr_find", "pr_read", "pr_checks", "main_workflow_runs",
  "text_generation"
];
const modelRoutes = [
  { provider_id: "google", account_id: "acct_google_gemini_free", model_id: "google/gemini-3.5-flash-lite-direct" },
  { provider_id: "openrouter", account_id: "acct_openrouter_primary", model_id: "nvidia/nemotron-3.5-lightning:free" }
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectId = String(process.env.MW2_SCOPE_PROJECT_ID || "").trim().toLowerCase();
const userId = String(process.env.MW2_SCOPE_USER_ID || "").trim();
const goal = String(process.env.MW2_SCOPE_GOAL || "").trim();
const secret = String(process.env.ARIA_RUNTIME_SHARED_SECRET || "");
const confirm = String(process.env.MW2_SCOPE_CONFIRM || "");

if (confirm !== "true") throw new Error("explicit_scope_confirmation_required");
if (!uuid.test(userId)) throw new Error("scope_user_id_invalid");
if (!["aria", "battlecruiser", "cuevacoin"].includes(projectId)) throw new Error("scope_project_id_invalid");
if (goal.length < 20 || goal.length > 2000) throw new Error("scope_goal_length_invalid");
if (secret.length < 32) throw new Error("runtime_scope_secret_unavailable");

const now = Date.now();
const payload = {
  v: 1,
  purpose,
  scope_id: crypto.randomUUID(),
  user_id: userId,
  project_id: projectId,
  request_id: crypto.randomUUID(),
  mission_id: "mission_mw2_pwa_" + crypto.randomUUID().replace(/-/g, ""),
  goal_sha256: crypto.createHash("sha256").update(goal, "utf8").digest("hex"),
  issued_at: new Date(now).toISOString(),
  expires_at: new Date(now + 15 * 60 * 1000).toISOString(),
  max_steps: 4,
  max_attempts: 2,
  allowed_operations: operations,
  allowed_model_routes: modelRoutes
};
const payload_b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signature_b64 = crypto.createHmac("sha256", secret).update(payload_b64, "utf8").digest("base64url");
const token = payload_b64 + "." + signature_b64;
const outDir = path.resolve(process.env.MW2_SCOPE_OUTPUT_DIR || "mission-scope-artifact");
fs.mkdirSync(outDir, { recursive: true });
const output = {
  format: "mission-wonder-2-pwa-scope-v1",
  token,
  scope: {
    scope_id: payload.scope_id,
    user_id: payload.user_id,
    project_id: payload.project_id,
    request_id: payload.request_id,
    mission_id: payload.mission_id,
    goal_sha256: payload.goal_sha256,
    expires_at: payload.expires_at,
    max_steps: payload.max_steps,
    max_attempts: payload.max_attempts,
    allowed_operations: payload.allowed_operations
  }
};
fs.writeFileSync(path.join(outDir, "mission-scope.json"), JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "scope_id=" + payload.scope_id + "\n");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "mission_id=" + payload.mission_id + "\n");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "request_id=" + payload.request_id + "\n");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "expires_at=" + payload.expires_at + "\n");
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## Mission Wonder 2 — scope PWA one-shot emitido",
    "",
    "- Scope: `" + payload.scope_id + "`",
    "- Mission ID: `" + payload.mission_id + "`",
    "- Request ID: `" + payload.request_id + "`",
    "- Proyecto: `" + payload.project_id + "`",
    "- Vence: " + payload.expires_at,
    "- Plan máximo: " + payload.max_steps + " pasos · " + payload.max_attempts + " intentos por paso",
    "- Operaciones: solo lectura GitHub + text generation cloud allowlisted",
    "- Token: adjunto como artefacto protegido de 1 día; no se imprime en logs",
    "",
    "La misión todavía no ha sido creada ni despachada. El freeze global sigue activo."
  ].join("\n") + "\n");
}
process.stdout.write("MW2_PWA_SCOPE_ISSUED=true\n");
process.stdout.write("MW2_PWA_SCOPE_EXPIRES_AT=" + payload.expires_at + "\n");
