import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toolLoop } from "./tool-loop.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const EXEC = `${URL}/functions/v1/aria-execution-runtime-v1`;
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
  "aria-agent-planner-gemini35-v1": { role: "planner", system: "You are ARIA's planning specialist on the current verified Gemini direct route. Produce concise actionable planning guidance. Never claim execution you did not perform." },
  "aria-agent-verifier-gemini35-v1": { role: "verifier", system: "You are ARIA's verification specialist on the current verified Gemini direct route. Inspect evidence, distinguish fact from hypothesis, and report target-aligned findings." },
};
type CatalogAgent = { agent_id: string; role: string; capabilities: string[]; scope: string[]; max_risk: string; status: string; model_id: string };
async function loadCatalog(): Promise<CatalogAgent[]> { const { data, error } = await sb.rpc("aria_agent_catalog"); if (error || !Array.isArray(data)) return []; return data.filter((x: any) => x && typeof x.agent_id === "string" && typeof x.status === "string" && typeof x.model_id === "string") as CatalogAgent[]; }
async function resolveResource(id: string, capability = "text_generation") {
  const { data, error } = await internal.rpc("resolve_agent_resource", { p_agent_id: id, p_capability_id: capability });
  if (error || !data || typeof data !== "object") return null;
  return data as any;
}
async function catalogFor(id: string) {
  const resource = await resolveResource(id);
  if (!resource || resource.status !== "ready") return null;
  return resource;
}
const RISK_RANK: Record<string, number> = { READ: 0, read: 0, LOW: 1, low: 1, LOW_RISK_WRITE: 1, MEDIUM: 2, medium: 2, MEDIUM_RISK_WRITE: 2, HIGH: 3, high: 3, HIGH_RISK_WRITE: 3, DESTRUCTIVE: 4, destructive: 4, CRITICAL: 4, critical: 4 };
const MAX_RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, destructive: 4 };
function riskAllowed(requested: string, maximum: string) { return (RISK_RANK[requested] ?? 4) <= (MAX_RISK_RANK[maximum] ?? -1); }
async function recordDiagnostic(missionId: string, stepId: string, payload: Record<string, unknown>) { try { await internal.from("mission_events").insert({ mission_id: missionId, step_index: null, event_type: "agent_executor_diagnostic", payload: { mission_id: missionId, step_id: stepId, ...payload } }); } catch {} }

Deno.serve(async (r) => {
  if (r.method === "GET") { const catalog = await loadCatalog(); const resources = []; for (const a of catalog.filter(a => a.status === "available")) { const resource = await resolveResource(a.agent_id); if (resource) resources.push(resource); } return out({ ok: true, service: "aria-agent-runtime-v1", executor_type: "agent", catalog_source: "aria_agent_catalog", resource_graph: "aria_internal.resolve_agent_resource", available_agents: catalog.filter(a => a.status === "available"), ready_resources: resources.filter((r:any) => r.status === "ready"), blocked_resources: resources.filter((r:any) => r.status !== "ready") }); }
  if (r.method !== "POST") return out({ error: "method_not_allowed" }, 405); if (!(await auth(r))) return out({ error: "unauthorized" }, 401);
  const b: any = await r.json().catch(() => ({})); const agentId = String(b.agent_id || ""); const profile = profiles[agentId]; if (!profile) return out({ ok: false, status: "blocked", error: { code: "agent_not_profiled" } });
  const agent = await catalogFor(agentId); if (!agent) return out({ ok: false, status: "blocked", error: { code: "agent_unavailable_or_not_cataloged", agent_id: agentId } });
  const catalogAgent = agent.agent;
  const resource = agent;
  if (String(b.operation || "delegate") !== "delegate") return out({ ok: false, status: "blocked", error: { code: "operation_not_supported" } });
  const missionId = String(b.mission_id || ""), stepId = String(b.step_id || ""); if (!missionId || !stepId) return out({ ok: false, status: "blocked", error: { code: "mission_or_step_missing" } });
  const requestedRisk = String(b.risk || "READ"); if (!riskAllowed(requestedRisk, catalogAgent.max_risk)) return out({ ok: false, status: "blocked", error: { code: "agent_risk_exceeded", agent_id: agentId, requested_risk: requestedRisk, max_risk: catalogAgent.max_risk } });
  if (!catalogAgent.scope.includes("reason")) return out({ ok: false, status: "blocked", error: { code: "agent_scope_denied", agent_id: agentId, required_scope: "reason" } });
  const prompt = typeof b.input?.prompt === "string" ? b.input.prompt.trim() : String(b.input?.message || "").trim(); if (!prompt) return out({ ok: false, status: "blocked", error: { code: "prompt_missing" } });
  const repairRequired = b.policy?.repair_required === true; const toolUse = b.policy?.tool_use === true || repairRequired;
  try {
    if (repairRequired) {
      if (agentId !== "aria-agent-coding-v1") return out({ ok: false, status: "blocked", error: { code: "repair_agent_must_be_coding_agent", agent_id: agentId } });
      if (requestedRisk !== "LOW_RISK_WRITE") return out({ ok: false, status: "blocked", error: { code: "repair_requires_low_risk_write", requested_risk: requestedRisk } });
      if (!catalogAgent.scope.includes("code")) return out({ ok: false, status: "blocked", error: { code: "repair_agent_lacks_code_scope" } });
      return out(await toolLoop(agent, missionId, stepId, prompt, true));
    }
    if (toolUse) return out(await toolLoop(agent, missionId, stepId, prompt, false));
    const requestId = `agent:${missionId}:${stepId}`;
    const rr = await fetch(EXEC, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ execution_version: "1", request_id: requestId, task_id: stepId, capability: "text_generation", selected_route: { status: "selected", provider_id: resource.provider.provider_id, account_id: resource.account.account_id, model_id: resource.model.model_id, capability: resource.capability.capability_id }, authorization: { status: "approved", risk_class: requestedRisk, evidence_ref: `agent:${agentId}` }, input: { payload: { prompt: `${profile.system}\n\nTask:\n${prompt}` } }, policy: b.policy || {}, metadata: { executor_type: "agent", agent_id: agentId, agent_role: catalogAgent.role, mission_id: missionId, step_id: stepId, catalog_source: "aria_agent_catalog", resource_graph: "aria_internal.resolve_agent_resource", provider_id: resource.provider.provider_id, account_id: resource.account.account_id, model_id: resource.model.model_id, capability_id: resource.capability.capability_id } }) });
    const x: any = await rr.json().catch(() => null);
    if (!rr.ok || x?.status !== "succeeded") {
      const message = String(x?.error?.message || x?.error || `execution_${rr.status}`);
      await recordDiagnostic(missionId, stepId, { status: "failed", code: "agent_execution_failed", message, provider_status: x?.error?.provider_status ?? rr.status });
      return out({ ok: false, status: "failed", agent_id: agentId, executor_type: "agent", error: { code: "agent_execution_failed", message } });
    }
    return out({ ok: true, status: "succeeded", executor_type: "agent", agent_id: agentId, role: catalogAgent.role, operation: "delegate", provider_id: resource.provider.provider_id, account_id: resource.account.account_id, model_id: resource.model.model_id, capability_id: resource.capability.capability_id, response: x.response, usage: x.usage, metadata: { mission_id: missionId, step_id: stepId, catalog_source: "aria_agent_catalog", resource_graph: "aria_internal.resolve_agent_resource", evidence_ref: `execution:${missionId}:${stepId}` } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordDiagnostic(missionId, stepId, { status: "failed", code: "agent_runtime_exception", message });
    return out({ ok: false, status: "failed", executor_type: "agent", agent_id: agentId, error: { code: "agent_runtime_exception", message } });
  }
});
