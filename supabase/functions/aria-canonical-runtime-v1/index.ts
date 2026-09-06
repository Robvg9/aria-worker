import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUNNER = `${URL}/functions/v1/aria-mission-runner-v17`;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bearer = (request: Request) => { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : null; };
const constantTimeEqual = (a: string, b: string) => { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); if (x.length !== y.length) return false; let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]; return diff === 0; };
async function authorized(request: Request) { const token = bearer(request); if (token && SECRET && constantTimeEqual(token, SECRET)) return true; const autonomyToken = request.headers.get("x-aria-autonomy-token") ?? token; if (!autonomyToken) return false; const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: autonomyToken }); return !error && data === true; }
Deno.serve(async (request) => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(request))) return out({ error: "unauthorized" }, 401);
  const body = await request.text();
  const incomingAutonomyToken = request.headers.get("x-aria-autonomy-token");
  const incomingBearer = bearer(request);
  const headers = new Headers({ "content-type": "application/json" });
  if (incomingAutonomyToken) headers.set("x-aria-autonomy-token", incomingAutonomyToken);
  if (!incomingAutonomyToken && incomingBearer) headers.set("authorization", `Bearer ${incomingBearer}`);
  if (!incomingAutonomyToken && !incomingBearer && SECRET) headers.set("authorization", `Bearer ${SECRET}`);
  const trace = request.headers.get("X-ARIA-Trace-Id");
  if (trace) headers.set("X-ARIA-Trace-Id", trace);
  try {
    const upstream = await fetch(RUNNER, { method: "POST", headers, body });
    const responseBody = await upstream.text();
    return new Response(responseBody, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return out({ ok: false, status: "unavailable", error: error instanceof Error ? error.message : String(error), runtime: "canonical-runtime-v1" }, 503);
  }
});
