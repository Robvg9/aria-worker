import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RUNTIME_SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const DIRECT = `${SUPABASE_URL}/functions/v1/aria-direct-v1`;
const MEMORY = `${SUPABASE_URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${SUPABASE_URL}/functions/v1/aria-planner-v11`;
const EXEC = `${SUPABASE_URL}/functions/v1/aria-execution-runtime-v1`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, x-aria-trace-id, content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
});

const bearer = (request: Request) => {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function adminClient() {
  if (!SERVICE_ROLE_KEY) throw new Error("server_auth_not_configured");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false },
  });
}

async function authenticateUser(token: string) {
  // The Edge gateway already validates Authorization because verify_jwt=true.
  // This server-side lookup obtains the authoritative user object without depending on a legacy anon key env var.
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user?.id) throw new Error("user_session_invalid");
  return data.user;
}

async function internalFetch(url: string, payload: unknown) {
  if (!RUNTIME_SECRET) throw new Error("runtime_secret_not_configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${RUNTIME_SECRET}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function recall(query: string) {
  try {
    const { response, body } = await internalFetch(MEMORY, { action: "search", query, limit: 8 });
    return { ok: response.ok, results: Array.isArray(body?.results) ? body.results : [], status: response.status };
  } catch {
    return { ok: false, results: [], status: 0 };
  }
}

async function planConversation(goal: string, context: unknown) {
  const { response, body } = await internalFetch(PLANNER, {
    goal: `IA conversacional: responde al usuario de forma natural y útil. ${goal}`,
    context,
  });
  if (!response.ok || body?.ok !== true || !Array.isArray(body?.plan?.steps) || !body.plan.steps[0]) {
    throw new Error(`planner_http_${response.status}_${body?.error ?? "invalid_plan"}`);
  }
  return body.plan.steps[0];
}

async function executeConversation(step: any, prompt: string, conversationId: string) {
  const target = step?.target;
  if (!target?.provider_id || !target?.account_id || !target?.model_id) {
    throw new Error("executor_contract_route_incomplete");
  }
  const { response, body } = await internalFetch(EXEC, {
    execution_version: "1",
    request_id: `${conversationId}:${crypto.randomUUID()}`,
    task_id: `conversation:${conversationId}`,
    capability: "text_generation",
    selected_route: {
      status: "selected",
      provider_id: target.provider_id,
      account_id: target.account_id,
      model_id: target.model_id,
      capability: "text_generation",
    },
    authorization: {
      status: "approved",
      risk_class: "READ",
      evidence_ref: "aria-app-api-v3",
    },
    input: { payload: { prompt, max_tokens: 256, temperature: 0.3 } },
    policy: {},
    metadata: { conversation_id: conversationId, source_application: "aria-app-v1", executor_type: "model" },
  });
  if (!response.ok || body?.status !== "succeeded") {
    throw new Error(`executor_http_${response.status}_${body?.error?.code ?? body?.reason ?? "execution_failed"}`);
  }
  return body;
}

async function missionSubmit(goal: string, userId: string, conversationId: string) {
  const { response, body } = await internalFetch(DIRECT, {
    goal,
    metadata: { source_application: "aria-app-v1", user_id: userId, conversation_id: conversationId, goal_source: "user" },
  });
  if (!response.ok) throw new Error(`mission_intake_http_${response.status}_${body?.error ?? "failed"}`);
  return body;
}

Deno.serve(async (request) => {
  const traceId = request.headers.get("x-aria-trace-id") ?? crypto.randomUUID();
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const token = bearer(request);
    if (!token) return json({ error: "unauthorized", stage: "auth", trace_id: traceId }, 401);

    const user = await authenticateUser(token);
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    if (request.method === "GET" && path.endsWith("/session")) {
      return json({ ok: true, service: "aria-app-api-v3", user: { id: user.id, email: user.email ?? null }, trace_id: traceId });
    }

    if (request.method === "GET" && path.endsWith("/system")) {
      const response = await fetch(DIRECT);
      const body = await response.json().catch(() => null);
      return json({ ok: response.ok, service: "aria-app-api-v3", user_id: user.id, aria: body, trace_id: traceId }, response.ok ? 200 : 502);
    }

    if (request.method === "POST" && path.endsWith("/conversation")) {
      const body = await request.json().catch(() => null);
      const parts = Array.isArray(body?.parts) ? body.parts : [];
      const goal = parts.filter((part: any) => part?.type === "text")
        .map((part: any) => String(part.text ?? "").trim()).filter(Boolean).join("\n");
      if (!goal) return json({ error: "text_required", stage: "input", trace_id: traceId }, 400);

      const conversationId = typeof body?.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim() : crypto.randomUUID();

      const remembered = await recall(goal);
      let step: any;
      try {
        step = await planConversation(goal, {
          version: "cognitive-loop-v2",
          memory: remembered.results.slice(0, 6),
          memory_available: remembered.ok,
        });
      } catch (error) {
        return json({ error: "conversation_planner_failed", stage: "planner", detail: errorText(error), trace_id: traceId }, 503);
      }

      const memoryText = remembered.results.slice(0, 6)
        .map((item: any) => String(item?.content ?? "").trim()).filter(Boolean).join("\n\n");
      const prompt = [
        "Eres ARIA. Responde directamente al usuario.",
        "No inventes acciones ejecutadas. Si una tarea requiere ejecución, debe convertirse en misión.",
        "No reveles datos privados de otros usuarios ni secretos.",
        memoryText ? `Memoria contextual autorizada:\n${memoryText}` : "",
        `Usuario: ${goal}`,
      ].filter(Boolean).join("\n\n");

      try {
        const result = await executeConversation(step, prompt, conversationId);
        const content = result?.response?.content;
        if (typeof content !== "string" || !content.trim()) {
          return json({ error: "empty_conversation_response", stage: "model_execution", trace_id: traceId }, 502);
        }
        return json({
          ok: true,
          conversationId,
          messageId: crypto.randomUUID(),
          visualState: "success",
          parts: [{ type: "text", text: content }],
          cognitive: {
            recall_count: remembered.results.length,
            provider_id: step.target.provider_id,
            model_id: step.target.model_id,
          },
          trace_id: traceId,
        });
      } catch (error) {
        return json({ error: "conversation_model_execution_failed", stage: "model_execution", detail: errorText(error), trace_id: traceId }, 502);
      }
    }

    if (request.method === "POST" && path.endsWith("/missions")) {
      const body = await request.json().catch(() => null);
      const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
      if (!goal) return json({ error: "goal_required" }, 400);
      const conversationId = typeof body?.conversationId === "string" ? body.conversationId : crypto.randomUUID();
      try {
        const result = await missionSubmit(goal, user.id, conversationId);
        return json({ ok: true, conversationId, messageId: crypto.randomUUID(), visualState: "planning", missionId: result?.mission?.mission_id ?? result?.mission_id ?? null, mission: result?.mission ?? null, parts: [{ type: "text", text: "He recibido tu misión. ARIA la está procesando." }] });
      } catch (error) {
        return json({ error: "mission_intake_failed", stage: "mission_intake", detail: errorText(error) }, 502);
      }
    }

    if (request.method === "POST" && path.endsWith("/memory/search")) {
      const body = await request.json().catch(() => null);
      const query = typeof body?.query === "string" ? body.query.trim() : "";
      if (!query) return json({ error: "query_required" }, 400);
      const result = await recall(query);
      return json({ ok: true, query, result_count: result.results.length, results: result.results });
    }

    return json({ error: "not_found", stage: "routing", trace_id: traceId }, 404);
  } catch (error) {
    return json({ error: "internal_error", stage: "gateway", detail: errorText(error), trace_id: traceId }, 500);
  }
});
