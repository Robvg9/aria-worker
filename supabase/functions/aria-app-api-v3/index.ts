import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const DIRECT = `${SUPABASE_URL}/functions/v1/aria-direct-v1`;
const MEMORY = `${SUPABASE_URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${SUPABASE_URL}/functions/v1/aria-planner-v11`;
const EXEC = `${SUPABASE_URL}/functions/v1/aria-execution-runtime-v1`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,apikey,x-client-info,x-aria-trace-id,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS }
});

const bearer = (req: Request) => {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};

async function requireUser(token: string) {
  if (!token) throw Object.assign(new Error("missing_authorization"), { status: 401 });
  if (!ANON) throw new Error("supabase_auth_public_key_not_configured");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.id) throw Object.assign(new Error(`supabase_auth_${r.status}`), { status: 401 });
  return b;
}

async function internal(url: string, payload: unknown) {
  if (!SECRET) throw new Error("runtime_secret_not_configured");
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify(payload) });
  const b = await r.json().catch(() => null);
  return { r, b };
}

async function recall(text: string, userId: string) {
  try { const x = await internal(MEMORY, { action: "search", query: text, limit: 8, user_id: userId }); return Array.isArray(x.b?.results) ? x.b.results : []; }
  catch { return []; }
}

async function plan(text: string, context: unknown) {
  const x = await internal(PLANNER, { goal: `IA conversacional: responde al usuario de forma natural y útil. ${text}`, context });
  if (!x.r.ok || x.b?.ok !== true || !x.b?.plan?.steps?.[0]) throw new Error(`planner_http_${x.r.status}_${x.b?.error ?? "invalid_plan"}`);
  return x.b.plan.steps[0];
}

async function execute(step: any, prompt: string, conversationId: string) {
  const target = step?.target;
  if (!target?.provider_id || !target?.account_id || !target?.model_id) throw new Error("executor_contract_route_incomplete");
  const x = await internal(EXEC, { execution_version: "1", request_id: `${conversationId}:${crypto.randomUUID()}`, task_id: `conversation:${conversationId}`, capability: "text_generation", selected_route: { status: "selected", provider_id: target.provider_id, account_id: target.account_id, model_id: target.model_id, capability: "text_generation" }, authorization: { status: "approved", risk_class: "READ", evidence_ref: "aria-app-api-v3" }, input: { payload: { messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], max_tokens: 512, temperature: 0.3 } }, policy: {}, metadata: { conversation_id: conversationId, source_application: "aria-app-v1", executor_type: "model", multimodal: false } });
  if (!x.r.ok || x.b?.status !== "succeeded") throw new Error(`executor_http_${x.r.status}_${x.b?.error?.code ?? x.b?.reason ?? "execution_failed"}`);
  return x.b;
}

Deno.serve(async (req) => {
  const trace = req.headers.get("x-aria-trace-id") ?? crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  let user: any;
  try { user = await requireUser(bearer(req)); }
  catch (e) { const status = (e as any)?.status === 401 ? 401 : 500; return json({ error: status === 401 ? "invalid_or_expired_session" : "gateway_auth_failure", stage: "auth", detail: String((e as any)?.message ?? e), trace_id: trace }, status); }

  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path.endsWith("/session")) return json({ ok: true, service: "aria-app-api-v3", user: { id: user.id, email: user.email ?? null }, trace_id: trace });
    if (req.method === "GET" && path.endsWith("/system")) { const r = await fetch(DIRECT); const b = await r.json().catch(() => null); return json({ ok: r.ok, service: "aria-app-api-v3", user_id: user.id, aria: b, trace_id: trace }, r.ok ? 200 : 502); }
    if (req.method === "POST" && path.endsWith("/conversation")) {
      const body = await req.json().catch(() => null); const parts = Array.isArray(body?.parts) ? body.parts : []; const text = parts.filter((p:any)=>p?.type==="text").map((p:any)=>String(p.text??"").trim()).filter(Boolean).join("\n");
      if (!text) return json({ error: "text_or_attachment_required", stage: "input", trace_id: trace }, 400);
      const conversationId = typeof body?.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : crypto.randomUUID();
      const memory = await recall(text, user.id);
      let step: any;
      try { step = await plan(text, { version: "cognitive-loop-v2", user_id: user.id, memory: memory.slice(0, 6), memory_available: memory.length > 0 }); }
      catch (e) { return json({ error: "conversation_planner_failed", stage: "planner", detail: String((e as any)?.message ?? e), trace_id: trace }, 503); }
      const context = memory.slice(0, 6).map((m:any)=>String(m?.content??"").trim()).filter(Boolean).join("\n\n");
      const prompt = ["Eres ARIA. Responde directamente al usuario.","No inventes acciones ejecutadas.",context ? `Memoria contextual autorizada:\n${context}` : "",`Usuario: ${text}`].filter(Boolean).join("\n\n");
      try { const result = await execute(step, prompt, conversationId); const content = typeof result?.response?.content === "string" ? result.response.content.trim() : ""; if (!content) throw new Error("empty_conversation_response"); return json({ ok: true, conversationId, visualState: "success", parts: [{ type: "text", text: content }], cognitive: { recall_count: memory.length, provider_id: step.target.provider_id, model_id: step.target.model_id }, trace_id: trace }); }
      catch (e) { return json({ error: "conversation_model_execution_failed", stage: "model_execution", detail: String((e as any)?.message ?? e), trace_id: trace }, 502); }
    }
    return json({ error: "not_found", stage: "routing", trace_id: trace }, 404);
  } catch (e) { return json({ error: "internal_error", stage: "gateway", detail: String((e as any)?.message ?? e), trace_id: trace }, 500); }
});
