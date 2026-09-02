import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export type TraceStage =
  | "mcp.request"
  | "mcp.auth"
  | "mcp.tool_call"
  | "mcp.upstream"
  | "oauth.metadata"
  | "oauth.register"
  | "oauth.authorize"
  | "oauth.ui"
  | "oauth.otp"
  | "oauth.callback"
  | "oauth.token"
  | "diagnostic";

export interface TraceEvent {
  traceId: string;
  stage: TraceStage;
  component: string;
  outcome: string;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  mcpMethod?: string | null;
  clientId?: string | null;
  hasBearer?: boolean | null;
  errorCode?: string | null;
  parentTraceId?: string | null;
  latencyMs?: number | null;
  details?: Record<string, unknown> | null;
}

const traceClient = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getTraceId(req: Request): string {
  const incoming = req.headers.get("x-aria-trace-id")?.trim();
  return incoming && /^[A-Za-z0-9_-]{16,128}$/.test(incoming) ? incoming : crypto.randomUUID();
}

export function traceHeaders(traceId: string): HeadersInit {
  return {
    "X-ARIA-Trace-Id": traceId,
    "Access-Control-Expose-Headers": "X-ARIA-Trace-Id, WWW-Authenticate",
  };
}

export async function recordTrace(event: TraceEvent): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  const safeDetails = event.details ? sanitizeDetails(event.details) : null;
  try {
    await traceClient().from("aria_mcp_trace_events").insert({
      trace_id: event.traceId,
      parent_trace_id: event.parentTraceId ?? null,
      stage: event.stage,
      component: event.component,
      outcome: event.outcome,
      method: event.method ?? null,
      path: event.path ?? null,
      status_code: event.statusCode ?? null,
      mcp_method: event.mcpMethod ?? null,
      client_id: event.clientId ?? null,
      has_bearer: event.hasBearer ?? null,
      error_code: event.errorCode ?? null,
      latency_ms: event.latencyMs ?? null,
      details: safeDetails,
    });
  } catch {
    // Observability is fail-open; tracing must never change authorization/runtime behavior.
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, unknown> {
  const forbidden = /token|secret|authorization|cookie|code_verifier|access_token|refresh_token|password/i;
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => {
    if (forbidden.test(key)) return false;
    if (typeof value === "string" && value.length > 512) return false;
    return ["string", "number", "boolean"].includes(typeof value) || value === null;
  }));
}
