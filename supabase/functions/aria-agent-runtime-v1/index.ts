import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const EXEC = `${URL}/functions/v1/aria-execution-runtime-v1`;
const GH = `${URL}/functions/v1/aria-github-app-runtime-v1`;
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } });
const internal = sb.schema("aria_internal");
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const eq = (a: string, b: string) => { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; };
const tokenOf = (r: Request) => { const h = r.headers.get("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7) : r.headers.get("x-aria-autonomy-token"); };
async function auth(r: Request) { const t = tokenOf(r); if (t && SECRET && eq(t, SECRET)) return true; if (!t) return false; const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: t }); return !error && data === true; }
const profiles: Record<string, { role: string; system: string }> = {
  "aria-agent-planner-v1": { role: "planner", system: "You are ARIA's planning specialist. Produce concise actionable planning guidance. Never claim execution you did not perform." },
  "aria-agent-reviewer-v1": { role: "reviewer", system: "You are ARIA's verification specialist. Inspect available evidence, distinguish fact from hypothesis, and report target-aligned findings." },
  "aria-agent-research-v1": { role: "researcher", system: "You are ARIA's research specialist. Gather evidence with available read tools, distinguish facts from uncertainty, and report actionable findings." },
  "aria-agent-coding-v1": { role: "coder", system: "You are ARIA's coding repair specialist. Inspect the repository, identify root causes, make the smallest justified governed change, and never claim tests/deployment you did not verify." },
  "aria-agent-security-v1": { role: "security", system: "You are ARIA's security specialist. Inspect available evidence for vulnerabilities, permission issues, secret exposure, and safe mitigations." },
  "aria-agent-memory-v1": { role: "memory", system: "You are ARIA's memory specialist. Inspect evidence about recall, consolidation, provenance, confidence, and reusable lessons." },
  "aria-agent-business-v1": { role: "business", system: "You are ARIA's business strategy specialist. Produce concrete evidence-aware analysis and next actions." },
  "aria-agent-device-v1": { role: "device", system: "You are ARIA's device/runtime diagnostics specialist. Inspect available runtime evidence and propose safe actionable diagnostics." },
};
type CatalogAgent = { agent_id: string; role: string; capabilities: string[]; scope: string[]; max_risk: string; status: string; model_id: string };
async function loadCatalog(): Promise<CatalogAgent[]> { const { data, error } = await sb.rpc("aria_agent_catalog"); if (error || !Array.isArray(data)) return []; return data.filter((x: any) => x && typeof x.agent_id === "string" && typeof x.status === "string" && typeof x.model_id === "string") as CatalogAgent[]; }
async function catalogFor(id: string) { const c = await loadCatalog(); return c.find(a => a.agent_id === id && a.status === "available") ?? null; }
const RISK_RANK: Record<string, number> = { READ: 0, read: 0, LOW: 1, low: 1, LOW_RISK_WRITE: 1, MEDIUM: 2, medium: 2, MEDIUM_RISK_WRITE: 2, HIGH: 3, high: 3, HIGH_RISK_WRITE: 3, DESTRUCTIVE: 4, destructive: 4, CRITICAL: 4, critical: 4 };
const MAX_RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, destructive: 4 };
function riskAllowed(requested: string, maximum: string) { return (RISK_RANK[requested] ?? 4) <= (MAX_RISK_RANK[maximum] ?? -1); }
async function recordDiagnostic(missionId: string, stepId: string, payload: Record<string, unknown>) { try { await internal.from("mission_events").insert({ mission_id: missionId, step_index: null, event_type: "agent_executor_diagnostic", payload: { mission_id: missionId, step_id: stepId, ...payload } }); } catch {} }
function b64decode(s: string) { const clean = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"); const padded = clean + "=".repeat((4 - clean.length % 4) % 4); const raw = atob(padded); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return new TextDecoder().decode(bytes); }
async function ghTool(operation: string, args: Record<string, unknown>) { const response = await fetch(GH, { method: "POST", headers: { "content-type": "application/json", "x-aria-autonomy-token": SECRET }, body: JSON.stringify({ operation, ...args }) }); const body: any = await response.json().catch(() => null); if (!response.ok || body?.ok !== true) throw new Error(String(body?.error || `github_tool_http_${response.status}`)); if (operation === "file_read") { const d = body.data; return { ok: true, operation, path: args.path, branch: args.branch ?? "main", content: d?.content ? b64decode(String(d.content)) : null, sha: d?.sha ?? null }; } return { ok: true, operation, data: body.data ?? null }; }
const readTools = [
  { type: "function", function: { name: "github_tree_read", description: "List repository source paths from Robvg9/aria-worker on main.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "github_code_search", description: "Search source code in Robvg9/aria-worker on main.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "github_file_read", description: "Read a text file from Robvg9/aria-worker.", parameters: { type: "object", properties: { path: { type: "string" }, branch: { type: "string" } }, required: ["path"] } } },
];
const writeTool = { type: "function", function: { name: "github_file_write", description: "Write a complete UTF-8 file to a governed non-main repair branch. Never write main/master.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"] } } };
async function callModel(model: string, messages: any[], tools: any[]) { const { data: secret, error } = await internal.rpc("credential_read_secret", { p_name: "aria_openrouter_primary" }); if (error || typeof secret !== "string" || secret.length < 10) throw new Error("openrouter_credential_unavailable"); const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 3000, tools, tool_choice: tools.length ? "auto" : undefined }) }); const body: any = await response.json().catch(() => null); if (!response.ok) throw new Error(`openrouter_http_${response.status}:${body?.error?.message ?? "provider_error"}`); return body?.choices?.[0]?.message ?? null; }
async function toolLoop(agent: CatalogAgent, missionId: string, stepId: string, prompt: string, allowWrite: boolean) {
  const branch = `aria/repair/${missionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}`;
  const tools = allowWrite ? [...readTools, writeTool] : readTools;
  const system = [`You are ARIA's governed ${agent.role} executor.`, "Use available tools to inspect evidence.", allowWrite ? `For changes, use only non-main branch ${branch}; never modify main/master. A concrete write is required for a repair unless NO_CHANGE_REQUIRED is justified.` : "This is read-only: do not fabricate changes.", "Never claim tests, deployment, or production changes that were not actually verified.", "Your final response is mandatory: begin with FINDINGS: and finish with VERDICT:. Include concrete evidence from the tools you actually used.", "Distinguish CONFIRMED, HYPOTHESIS, and BLOCKED."].join(" ");
  let messages: any[] = [{ role: "system", content: `${system}\n\nTask:\n${prompt}` }];
  const writes: any[] = []; const reads: any[] = []; let text = ""; let branchCreated = false;
  for (let round = 0; round < 8; round += 1) {
    const message = await callModel(agent.model_id, messages, tools); if (!message) throw new Error("agent_model_empty");
    text = typeof message.content === "string" ? message.content.trim() : "";
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) break;
    messages.push(message);
    for (const toolCall of message.tool_calls.slice(0, 4)) {
      const name = String(toolCall?.function?.name || ""); let args: any = {}; try { args = JSON.parse(toolCall?.function?.arguments || "{}"); } catch { args = {}; }
      let result: any;
      try {
        if (name === "github_tree_read") { result = await ghTool("tree_read", { owner: "Robvg9", repo: "aria-worker", branch: "main" }); reads.push({ operation: name }); }
        else if (name === "github_code_search") { result = await ghTool("code_search", { owner: "Robvg9", repo: "aria-worker", query: String(args.query || "") }); reads.push({ operation: name, query: String(args.query || "") }); }
        else if (name === "github_file_read") { const readBranch = String(args.branch || "main"); result = await ghTool("file_read", { owner: "Robvg9", repo: "aria-worker", branch: readBranch, path: String(args.path || "") }); reads.push({ operation: name, path: String(args.path || ""), branch: readBranch }); }
        else if (name === "github_file_write" && allowWrite) { if (!branchCreated) { await ghTool("create_branch", { owner: "Robvg9", repo: "aria-worker", branch, ref: "main" }); branchCreated = true; } result = await ghTool("file_write", { owner: "Robvg9", repo: "aria-worker", branch, path: String(args.path || ""), content: String(args.content ?? ""), message: String(args.message || "chore: ARIA governed repair"), risk_level: "low" }); writes.push({ path: String(args.path || ""), branch, commit_sha: result?.data?.commit_sha ?? null }); }
        else result = { ok: false, error: `unsupported_tool:${name}` };
      } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result).slice(0, 12000) });
      if (result?.ok === false && String(result?.error || "").includes("github_404")) await recordDiagnostic(missionId, stepId, { status: "blocked", code: "github_write_permission_or_installation_scope", message: String(result.error), operation: name, branch });
    }
    if (writes.length >= 6) break;
  }
  if (!/^FINDINGS:/i.test(text) || !/VERDICT:/i.test(text)) {
    messages.push({ role: "user", content: "You have finished tool inspection. Now produce the mandatory final report using only the evidence in this conversation. Begin exactly with FINDINGS: and finish with VERDICT:. Do not call any more tools. Do not claim any change/test/deployment you did not verify." });
    const finalMessage = await callModel(agent.model_id, messages, []);
    text = typeof finalMessage?.content === "string" ? finalMessage.content.trim() : "";
  }
  if (!/^FINDINGS:/i.test(text) || !/VERDICT:/i.test(text)) {
    await recordDiagnostic(missionId, stepId, { status: "failed", code: "agent_final_report_missing", message: "Tool-capable agent completed without mandatory FINDINGS/VERDICT report", reads_count: reads.length, writes_count: writes.length });
    return { status: "failed", executor_type: "agent", agent_id: agent.agent_id, role: agent.role, response: { content: text || "agent_final_report_missing" }, error: { code: "agent_final_report_missing", message: "Mandatory final evidence report was not produced" }, repair: { branch, changed: writes.length > 0, writes, reads, verified: false, verification_status: "failed" } };
  }
  if (writes.length > 0) {
    const pr = await ghTool("open_pr", { owner: "Robvg9", repo: "aria-worker", branch, base: "main", title: `ARIA repair: ${missionId}`, body: `Governed repair mission ${missionId}.\n\nChanged files:\n${writes.map(x => `- ${x.path}`).join("\n")}\n\nAgent report:\n${text.slice(0, 8000)}` });
    return { status: "succeeded", executor_type: "agent", agent_id: agent.agent_id, role: agent.role, response: { content: text }, repair: { branch, changed: true, writes, reads, pr: pr.data ?? null, summary: text, verified: false, verification_status: "awaiting_ci_or_live_verification" } };
  }
  if (/\bBLOCKED\b/i.test(text)) return { status: "blocked", executor_type: "agent", agent_id: agent.agent_id, role: agent.role, response: { content: text }, repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "blocked" }, error: { code: "repair_blocked", message: text.slice(0, 12000) };
  if (!allowWrite) return { status: "succeeded", executor_type: "agent", agent_id: agent.agent_id, role: agent.role, response: { content: text }, repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "evidence_only" } };
  if (/NO_CHANGE_REQUIRED/i.test(text)) return { status: "succeeded", executor_type: "agent", agent_id: agent.agent_id, role: agent.role, response: { content: text }, repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "unverified" } };
  return { status: "failed", executor_type: "agent", agent_id: agent.agent_id, role: agent.role, response: { content: text }, error: { code: "repair_no_mutation", message: "Repair mission produced a final report but no concrete mutation and was not classified as NO_CHANGE_REQUIRED or BLOCKED" }, repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "failed" } };
}
Deno.serve(async (r) => {
  if (r.method === "GET") { const catalog = await loadCatalog(); return out({ ok: true, service: "aria-agent-runtime-v1", executor_type: "agent", catalog_source: "aria_agent_catalog", available_agents: catalog.filter(a => a.status === "available") }); }
  if (r.method !== "POST") return out({ error: "method_not_allowed" }, 405); if (!(await auth(r))) return out({ error: "unauthorized" }, 401);
  const b: any = await r.json().catch(() => ({})); const agentId = String(b.agent_id || ""); const profile = profiles[agentId]; if (!profile) return out({ ok: false, status: "blocked", error: { code: "agent_not_profiled" } });
  const agent = await catalogFor(agentId); if (!agent) return out({ ok: false, status: "blocked", error: { code: "agent_unavailable_or_not_cataloged", agent_id: agentId } });
  if (String(b.operation || "delegate") !== "delegate") return out({ ok: false, status: "blocked", error: { code: "operation_not_supported" } });
  const missionId = String(b.mission_id || ""), stepId = String(b.step_id || ""); if (!missionId || !stepId) return out({ ok: false, status: "blocked", error: { code: "mission_or_step_missing" } });
  const requestedRisk = String(b.risk || "READ"); if (!riskAllowed(requestedRisk, agent.max_risk)) return out({ ok: false, status: "blocked", error: { code: "agent_risk_exceeded", agent_id: agentId, requested_risk: requestedRisk, max_risk: agent.max_risk } });
  if (!agent.scope.includes("reason")) return out({ ok: false, status: "blocked", error: { code: "agent_scope_denied", agent_id: agentId, required_scope: "reason" } });
  const prompt = typeof b.input?.prompt === "string" ? b.input.prompt.trim() : String(b.input?.message || "").trim(); if (!prompt) return out({ ok: false, status: "blocked", error: { code: "prompt_missing" } });
  const repairRequired = b.policy?.repair_required === true; const toolUse = b.policy?.tool_use === true || repairRequired;
  try {
    if (repairRequired) { if (agentId !== "aria-agent-coding-v1") return out({ ok: false, status: "blocked", error: { code: "repair_agent_must_be_coding_agent", agent_id: agentId } }); if (requestedRisk !== "LOW_RISK_WRITE") return out({ ok: false, status: "blocked", error: { code: "repair_requires_low_risk_write", requested_risk: requestedRisk } }); if (!agent.scope.includes("code")) return out({ ok: false, status: "blocked", error: { code: "repair_agent_lacks_code_scope" } }); return out(await toolLoop(agent, missionId, stepId, prompt, true)); }
    if (toolUse) return out(await toolLoop(agent, missionId, stepId, prompt, false));
    const rr = await fetch(EXEC, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ execution_version: "1", request_id: `agent:${missionId}:${stepId}`, task_id: stepId, capability: "text_generation", selected_route: { status: "selected", provider_id: "openrouter", account_id: "acct_openrouter_primary", model_id: agent.model_id, capability: "text_generation" }, authorization: { status: "approved", risk_class: requestedRisk, evidence_ref: `agent:${agentId}` }, input: { payload: { prompt: `${profile.system}\n\nTask:\n${prompt}` } }, policy: b.policy || {}, metadata: { executor_type: "agent", agent_id: agentId, agent_role: agent.role, mission_id: missionId, step_id: stepId, catalog_source: "aria_agent_catalog" } }) });
    const x: any = await rr.json().catch(() => null); if (!rr.ok || x?.status !== "succeeded") { const message = String(x?.error?.message || x?.error || `execution_${rr.status}`); await recordDiagnostic(missionId, stepId, { status: "failed", code: "agent_execution_failed", message, provider_status: x?.error?.provider_status ?? rr.status }); return out({ ok: false, status: "failed", agent_id: agentId, executor_type: "agent", error: { code: "agent_execution_failed", message } }); }
    return out({ ok: true, status: "succeeded", executor_type: "agent", agent_id: agentId, role: agent.role, operation: "delegate", provider_id: "openrouter", model_id: agent.model_id, response: x.response, usage: x.usage, metadata: { mission_id: missionId, step_id: stepId, catalog_source: "aria_agent_catalog" } });
  } catch (e) { const message = e instanceof Error ? e.message : String(e); await recordDiagnostic(missionId, stepId, { status: "failed", code: "agent_runtime_exception", message }); return out({ ok: false, status: "failed", executor_type: "agent", agent_id: agentId, error: { code: "agent_runtime_exception", message } }); }
});