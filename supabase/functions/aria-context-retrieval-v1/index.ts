import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canEnterGeneralIndex, parseRetrievalQuery } from "../_shared/private-route-contract.ts";

const LIMIT_BYTES = 65536;
const ORIGIN = "https://aria.robvg9.workers.dev";
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, private", "x-content-type-options": "nosniff" };
const reply = (status: number, data: Record<string, unknown>, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, ...extra } });
const bearer = (req: Request) => {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};

async function validUser(token: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const allowedOrigin = Boolean(origin && (
    origin === ORIGIN ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  ));
  if (origin && !allowedOrigin) return reply(403, { error: "origin_forbidden" });
  const cors: Record<string, string> = origin && allowedOrigin
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "authorization,content-type", "vary": "Origin" }
    : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, ...cors } });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, cors);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return reply(415, { error: "application_json_required" }, cors);

  const token = bearer(req);
  if (!token) return reply(401, { error: "unauthorized" }, { ...cors, "www-authenticate": "Bearer" });
  const user = await validUser(token);
  if (!user) return reply(401, { error: "invalid_token" }, cors);

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > LIMIT_BYTES) return reply(413, { error: "request_too_large" }, cors);
  let raw = "";
  try {
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { error: "invalid_json" }, cors);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > LIMIT_BYTES) {
        await reader.cancel();
        return reply(413, { error: "request_too_large" }, cors);
      }
      chunks.push(part.value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch { return reply(400, { error: "invalid_json" }, cors); }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }, cors); }
  const query = parseRetrievalQuery(body);
  if (!query) return reply(400, { error: "invalid_retrieval_request" }, cors);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return reply(503, { error: "retrieval_unavailable" }, cors);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Deny by default: shared retrieval only sees explicitly reviewed general documents.
  const { data, error } = await db.from("cb_chunks")
    .select("id,document_id,chunk_index,heading,content,cb_documents!inner(id,title,source_type,project,status,authority,metadata)")
    .eq("cb_documents.status", "vigente")
    .filter("cb_documents.metadata->>privacy_class", "eq", "general")
    .limit(100);
  if (error || !data) return reply(503, { error: "retrieval_unavailable" }, cors);

  const words = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((word) => word.length >= 3).slice(0, 16);
  const results = data.filter((row: any) => canEnterGeneralIndex(row.cb_documents?.metadata)).map((row: any) => {
    const doc = row.cb_documents ?? {};
    const haystack = `${doc.title ?? ""} ${row.heading ?? ""} ${row.content ?? ""}`.toLowerCase();
    const score = words.reduce((sum, word) => sum + Math.min(haystack.split(word).length - 1, 5), 0);
    return { row, score };
  }).filter((item: any) => item.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 8);

  const audit = await db.rpc("cb_record_retrieval", {
    query_text: "[REDACTED]",
    chunk_ids: results.map((item: any) => item.row.id),
    model_name: "aria-general-retrieval-v1",
    extra_metadata: { requester_user_id: user.id, transport: "mcp", source: "aria-context-retrieval-v1" },
  });
  if (audit.error) return reply(503, { error: "retrieval_unavailable" }, cors);

  return reply(200, {
    result_count: results.length,
    retrieval_event_id: audit.data ?? null,
    results: results.map((item: any) => ({
      chunk_id: item.row.id,
      document_id: item.row.document_id,
      chunk_index: item.row.chunk_index,
      heading: item.row.heading,
      content: item.row.content,
      relevance_score: item.score,
      document: {
        title: item.row.cb_documents?.title ?? null,
        source_type: item.row.cb_documents?.source_type ?? null,
        project: item.row.cb_documents?.project ?? null,
        authority: item.row.cb_documents?.authority ?? null,
      },
    })),
  }, cors);
});
