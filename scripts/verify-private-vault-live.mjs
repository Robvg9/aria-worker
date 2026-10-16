const base = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY ?? "");
const allowedOrigin = "https://aria.robvg9.workers.dev";
const deniedOrigin = "https://attacker.invalid";
const endpoint = base + "/functions/v1/aria-app-api-v3/private-vault/vaults?limit=1&offset=0";
const report = {
  checked_at: new Date().toISOString(),
  endpoint: "/functions/v1/aria-app-api-v3/private-vault/vaults",
  checks: [],
  ok: false,
};

async function call(method, origin, extraHeaders = {}) {
  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        apikey: publishableKey,
        origin,
        ...(method === "OPTIONS" ? {
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization,apikey,content-type",
        } : {}),
        ...extraHeaders,
      },
      cache: "no-store",
      redirect: "error",
    });
    let body = null;
    if (method !== "OPTIONS") {
      const raw = await response.text();
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        body = parsed && typeof parsed.error === "string" ? { error: parsed.error } : { shape: parsed === null ? "empty" : "json" };
      } catch {
        body = { shape: "non_json" };
      }
    }
    return {
      status: response.status,
      allow_origin: response.headers.get("access-control-allow-origin"),
      allow_methods: response.headers.get("access-control-allow-methods"),
      body,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

try {
  if (!base || !publishableKey) throw new Error("Required public probe configuration is missing.");
  const noAuth = await call("GET", allowedOrigin);
  const allowedPreflight = await call("OPTIONS", allowedOrigin);
  const deniedPreflight = await call("OPTIONS", deniedOrigin);

  report.checks = [
    {
      name: "missing_authorization_is_denied",
      pass: noAuth.status === 401 && noAuth.body?.error === "invalid_or_expired_session" && noAuth.allow_origin === allowedOrigin,
      observed: noAuth,
    },
    {
      name: "registered_origin_preflight_is_allowed",
      pass: allowedPreflight.status === 204 && allowedPreflight.allow_origin === allowedOrigin,
      observed: allowedPreflight,
    },
    {
      name: "untrusted_origin_preflight_is_not_granted",
      pass: deniedPreflight.status === 204 && deniedPreflight.allow_origin === null,
      observed: deniedPreflight,
    },
  ];
  report.ok = report.checks.every(check => check.pass);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
