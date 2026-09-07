import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Governed multi-agent runtime: catalog is the availability source of truth.
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const EXEC = `${URL}/functions/v1/aria-execution-runtime-v1`;
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), {
  status: s,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

const eq = (a: string, b: string) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

const token = (r: Request) => {
  const h = r.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : r.headers.get("x-aria-autonomy-token");
};

async function auth(r: Request) {
  const t = token(r);
  if (t && SECRET && eq(t, SECRET)) return true;
  if (!t) return false;
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: t });
  return !error && data === true;
}

const profiles: Record<string, { role: string; system: string }> = {
  "aria-agent-planner-v1": { role: "planner", system: "You are ARIA's planning specialist. Produce concise, actionable planning guidance. Do not claim execution." },
  "aria-agent-reviewer-v1": { role: "reviewer", system: "You are ARIA's verification specialist. Critically review the supplied task and return concrete findings only." },
  "aria-agent-research-v1": { role: "researcher", system: "You are ARIA's research specialist. Synthesize evidence, distinguish facts from uncertainty, and return actionable findings." },
  "aria-agent-coding-v1": { role: "coder", system: "You are ARIA's coding specialist. Reason about implementation, debugging, and safe code changes. Do not claim deployment unless verified." },
  "aria-agent-security-v1": { role: "security", system: "You are ARIA's security specialist. Identify vulnerabilities, permission issues, secret exposure, and safe mitigations." },
  "aria-agent-memory-v1": { role: "memory", system: "You are ARIA's memory specialist. Analyze recall, consolidation, provenance, confidence, and reusable lessons." },
  "aria-agent-business-v1": { role: "business", system: "You are ARIA's business strategy specialist. Produce concrete, evidence-aware strategy and prioritization." },
  "aria-agent-device-v1": { role: "device", system: "You are ARIA's device diagnostics specialist. Analyze device/runtime state and provide safe, actionable diagnostics." }
};

type CatalogAgent = {
  agent_id: string;
  role: string;
  capabilities: string[];
  scope: string[];
  max_risk: string;
  status: string;
  model_id: string;
};

async function loadCatalog(): Promise<CatalogAgent[]> {
  const { data, error } = await sb.rpc("aria_agent_catalog");
  if (error || !Array.isArray(data)) return [];
  return data.filter((item: unknown): item is CatalogAgent => {
    if (!item || typeof item !== "object") return false;
    const a = item as Partial<CatalogAgent>;
    return typeof a.agent_id === "string" && typeof a.status === "string" && typeof a.model_id === "string";
  });
}

async function catalogFor(agentId: string) {
  const catalog = await loadCatalog();
  return catalog.find((a) => a.agent_id === agentId && a.status === "available") ?? null;
}

const RISK_RANK: Record<string, number> = {
  READ: 0, read: 0, LOW: 1, low: 1, LOW_RISK_WRITE: 1,
  MEDIUM: 2, medium: 2, MEDIUM_RISK_WRITE: 2,
  HIGH: 3, high: 3, HIGH_RISK_WRITE: 3,
  DESTRUCTIVE: 4, destructive: 4, CRITICAL: 4, critical: 4
};
const MAX_RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, destructive: 4 };

function riskAllowed(requested: string, maximum: string) {
  const requestedRank = RISK_RANK[requested] ?? 4;
  const maximumRank = MAX_RISK_RANK[maximum] ?? -1;
  return requestedRank <= maximumRank;
}

function scopeAllows(agent: CatalogAgent, requestedOperation: string) {
  if (requestedOperation === "delegate") return agent.scope.includes("reason");
  return agent.scope.includes(requestedOperation);
}

Deno.serve(async r => {
  if (r.method === "GET") {
    const catalog = await loadCatalog();
    return out({
      ok: true,
      service: "aria-agent-runtime-v1",
      executor_type: "agent",
      catalog_source: "aria_agent_catalog",
      available_agents: catalog.filter(a => a.status === "available").map(a => ({
        agent_id: a.agent_id,
        role: a.role,
        capabilities: a.capabilities,
        scope: a.scope,
        max_risk: a.max_risk,
        model_id: a.model_id
      }))
    });
  }

  if (r.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await auth(r))) return out({ error: "unauthorized" }, 401);

  const b: any = await r.json().catch(() => ({}));
  const agentId = String(b.agent_id || "");
  const profile = profiles[agentId];
  if (!profile) return out({ ok: false, status: "blocked", error: { code: "agent_not_profiled" } }, 200);

  const catalogAgent = await catalogFor(agentId);
  if (!catalogAgent) {
    return out({ ok: false, status: "blocked", error: { code: "agent_unavailable_or_not_cataloged", agent_id: agentId } }, 200);
  }

  if (String(b.operation || "delegate") !== "delegate") {
    return out({ ok: false, status: "blocked", error: { code: "operation_not_supported" } }, 200);
  }

  const missionId = String(b.mission_id || "");
  const stepId = String(b.step_id || "");
  if (!missionId || !stepId) return out({ ok: false, status: "blocked", error: { code: "mission_or_step_missing" } }, 200);

  const requestedRisk = String(b.risk || "READ");
  if (!riskAllowed(requestedRisk, catalogAgent.max_risk)) {
    return out({ ok: false, status: "blocked", error: {
      code: "agent_risk_exceeded",
      agent_id: agentId,
      requested_risk: requestedRisk,
      max_risk: catalogAgent.max_risk
    } }, 200);
  }
  if (!scopeAllows(catalogAgent, "delegate")) {
    return out({ ok: false, status: "blocked", error: { code: "agent_scope_denied", agent_id: agentId, required_scope: "reason" } }, 200);
  }

  const prompt = typeof b.input?.prompt === "string" ? b.input.prompt.trim() : String(b.input?.message || "").trim();
  if (!prompt) return out({ ok: false, status: "blocked", error: { code: "prompt_missing" } }, 200);

  const route = {
    status: "selected",
    provider_id: "openrouter",
    account_id: "acct_openrouter_primary",
    model_id: catalogAgent.model_id,
    capability: "text_generation"
  };
  const requestId = `agent:${missionId}:${stepId}`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${SECRET}` };

  const rr = await fetch(EXEC, {
    method: "POST",
    headers,
    body: JSON.stringify({
      execution_version: "1",
      request_id: requestId,
      task_id: stepId,
      capability: "text_generation",
      selected_route: route,
      authorization: { status: "approved", risk_class: requestedRisk, evidence_ref: `agent:${agentId}` },
      input: { payload: { prompt: `${profile.system}\n\nTask:\n${prompt}` } },
      policy: b.policy || {},
      metadata: {
        executor_type: "agent",
        agent_id: agentId,
        agent_role: catalogAgent.role,
        mission_id: missionId,
        step_id: stepId,
        catalog_source: "aria_agent_catalog"
      }
    })
  });

  const x: any = await rr.json().catch(() => null);
  if (!rr.ok || x?.status !== "succeeded") {
    return out({ ok: false, status: "failed", agent_id: agentId, executor_type: "agent",
      error: { code: "agent_execution_failed", message: String(x?.error?.message || x?.error || `execution_${rr.status}`) } }, 200);
  }

  return out({
    ok: true, status: "succeeded", executor_type: "agent", agent_id: agentId,
    role: catalogAgent.role, operation: "delegate", provider_id: route.provider_id,
    model_id: route.model_id, response: x.response, usage: x.usage,
    metadata: { mission_id: missionId, step_id: stepId, catalog_source: "aria_agent_catalog" }
  });
});
