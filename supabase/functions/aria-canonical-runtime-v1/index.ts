import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RUNNER = `${Deno.env.get("SUPABASE_URL")}/functions/v1/aria-mission-runner-v17`;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function constantTimeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!SECRET) return out({ error: "runtime_secret_not_configured" }, 500);

  const token = bearer(request) ?? request.headers.get("x-aria-autonomy-token");
  if (!token || !constantTimeEqual(token, SECRET)) return out({ error: "unauthorized" }, 401);

  const body = await request.text();
  const headers = new Headers({
    "content-type": "application/json",
    "authorization": `Bearer ${SECRET}`
  });
  const trace = request.headers.get("X-ARIA-Trace-Id");
  if (trace) headers.set("X-ARIA-Trace-Id", trace);

  try {
    const upstream = await fetch(RUNNER, { method: "POST", headers, body });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return out({
      ok: false,
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
      runtime: "canonical-runtime-v1"
    }, 503);
  }
});
