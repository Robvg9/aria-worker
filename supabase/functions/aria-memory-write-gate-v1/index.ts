import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
};
const MAX_BODY_BYTES = 64 * 1024;
const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const bearer = (req: Request) => {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};

async function authenticatedUser(token: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!url || !anon) return null;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });
  const token = bearer(req);
  if (!token) return respond(401, { error: "unauthorized" });
  const user = await authenticatedUser(token);
  if (!user) return respond(401, { error: "unauthorized" });

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return respond(413, { error: "request_too_large" });
  }
  let raw = "";
  try {
    const reader = req.body?.getReader();
    if (!reader) return respond(400, { error: "invalid_json" });
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return respond(413, { error: "request_too_large" });
      }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return respond(400, { error: "invalid_json" });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond(400, { error: "invalid_json" });
    body = parsed as Record<string, unknown>;
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (body.mode !== "write") return respond(400, { error: "write_only" });
  if (user.app_metadata?.aria_memory_write !== true) {
    return respond(403, { error: "write_forbidden", code: "ARIA_MEMORY_WRITE_CLAIM_REQUIRED" });
  }

  // Temporary fail-closed protection: the live candidate schema has not yet received the
  // privacy-classification migration, so no plaintext candidate is admitted by this route.
  // Re-enable writes only after the class column/trigger is live and the caller-side privacy
  // policy is integrated and tested. No content from the request is persisted or logged here.
  return respond(503, {
    error: "privacy_classification_unavailable",
    code: "ARIA_MEMORY_PRIVACY_GATE_CLOSED",
    retryable: true,
  });
});
