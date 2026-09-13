import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SAFE = new Set(["reliability", "performance", "documentation", "observability", "capability_gap", "regression"]);
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const token = (r: Request) => { const h = r.headers.get("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7) : r.headers.get("x-aria-autonomy-token") ?? ""; };
const eq = (a: string, b: string) => { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; };
async function authorized(r: Request) { const t = token(r); if (SECRET && t && eq(t, SECRET)) return true; if (!t) return false; const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: t }); return !error && data === true; }
function classify(signal: any) {
  const risk = String(signal?.risk || "LOW").toUpperCase();
  const category = String(signal?.category || "capability_gap");
  const destructive = signal?.destructive === true || ["HIGH", "CRITICAL"].includes(risk) || signal?.production === true || signal?.external_authority === true || signal?.physical === true;
  return { executable: !destructive && SAFE.has(category), category, risk, human_gate_required: destructive || !SAFE.has(category), reasons: destructive ? ["frontier"] : !SAFE.has(category) ? ["category_not_autonomous"] : [] };
}
Deno.serve(async r => {
  if (r.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(r))) return out({ error: "unauthorized" }, 401);
  const body = await r.json().catch(() => ({}));
  const signal = body?.signal && typeof body.signal === "object" ? body.signal : {};
  const goal = typeof signal.goal === "string" ? signal.goal.trim().slice(0, 1000) : "";
  if (!goal) return out({ ok: false, status: "blocked", reason: "improvement_goal_required" }, 400);
  const classification = classify(signal);
  const approvals = { promote: false, deploy: false };
  if (!classification.executable) return out({ ok: true, status: "blocked", version: "self-improvement-runtime-v1", goal, classification, approvals, stop_reason: "autonomy_frontier" });
  return out({ ok: true, status: "accepted", version: "self-improvement-runtime-v1", goal, classification, approvals, pipeline: ["observe", "research", "plan", "build", "test", "security", "evaluate", "verify", "learn"], promotion: "human_gate", deployment: "human_gate", execution: "governed_contract_only" });
});