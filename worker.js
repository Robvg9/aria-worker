const SUPABASE_MCP =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-server-grok-v2";

const SUPABASE_OAUTH =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-oauth-grok-v2";

const RUNTIME_GATEWAY =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-runtime-gateway-v1";

const MISSION_INTAKE =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-intake-v1";

const RUNNER_URL =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v5";

const RESOURCE =
  "https://aria.robvg9.workers.dev/mcp";

const RESOURCE_METADATA =
  "https://aria.robvg9.workers.dev/.well-known/oauth-protected-resource/mcp";

const SCOPES = ["openid", "profile", "email"];

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra
    }
  });
}

function protectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [SUPABASE_OAUTH],
    bearer_methods_supported: ["header"],
    scopes_supported: SCOPES
  };
}

function authorizationServerMetadata() {
  return {
    issuer: SUPABASE_OAUTH,
    authorization_endpoint: `${SUPABASE_OAUTH}/authorize`,
    token_endpoint: `${SUPABASE_OAUTH}/token`,
    registration_endpoint: `${SUPABASE_OAUTH}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES
  };
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function extractBearer(request) {
  const value = request.headers.get("authorization");

  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);

  return match ? match[1] : null;
}

function rewriteAuthChallenge(response) {
  const headers = new Headers(response.headers);

  headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${RESOURCE_METADATA}", scope="${SCOPES.join(" ")}"`
  );

  headers.set(
    "Access-Control-Expose-Headers",
    "WWW-Authenticate, X-ARIA-Trace-Id"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function proxyRuntime(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!env.ARIA_RUNTIME_SHARED_SECRET) {
    return json({ error: "runtime_secret_not_configured" }, 500);
  }

  const incomingToken = extractBearer(request);

  if (
    !incomingToken ||
    !constantTimeEqual(
      incomingToken,
      env.ARIA_RUNTIME_SHARED_SECRET
    )
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await request.text();

  const upstream = await fetch(RUNTIME_GATEWAY, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`
    },
    body
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function startMission(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!env.ARIA_RUNTIME_SHARED_SECRET) {
    return json({ error: "runtime_secret_not_configured" }, 500);
  }

  const incomingToken = extractBearer(request);

  if (
    !incomingToken ||
    !constantTimeEqual(
      incomingToken,
      env.ARIA_RUNTIME_SHARED_SECRET
    )
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await request.text();

  const upstream = await fetch(MISSION_INTAKE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`
    },
    body
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function runScheduledMission(env) {
  if (!env.ARIA_RUNTIME_SHARED_SECRET) {
    console.error("[ARIA CRON] runtime secret not configured");
    return;
  }

  try {
    const response = await fetch(RUNNER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`
      },
      body: "{}"
    });

    console.log(
      `[ARIA CRON] runner status=${response.status}`
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[ARIA CRON] runner failure status=${response.status} body=${text.slice(0, 500)}`
      );
    }
  } catch (error) {
    console.error(
      `[ARIA CRON] runner request failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledMission(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * Protected Resource Metadata
     */
    if (
      request.method === "GET" &&
      (
        url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp"
      )
    ) {
      return json(protectedResourceMetadata(), 200, {
        "access-control-allow-origin": "*"
      });
    }

    /*
     * OAuth Authorization Server Metadata
     */
    if (
      request.method === "GET" &&
      (
        url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname ===
          "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2"
      )
    ) {
      return json(authorizationServerMetadata(), 200, {
        "access-control-allow-origin": "*"
      });
    }

    /*
     * Autonomous Mission Intake
     */
    if (
      url.pathname === "/mission" ||
      url.pathname === "/mission/"
    ) {
      return startMission(request, env);
    }

    /*
     * Runtime Gateway
     */
    if (
      url.pathname === "/runtime" ||
      url.pathname === "/runtime/"
    ) {
      return proxyRuntime(request, env);
    }

    /*
     * MCP endpoint
     */
    if (
      url.pathname === "/mcp" ||
      url.pathname === "/mcp/"
    ) {
      const upstreamUrl = new URL(SUPABASE_MCP);

      upstreamUrl.search = url.search;

      const headers = new Headers(request.headers);

      const incomingTrace = headers.get("X-ARIA-Trace-Id");

      if (incomingTrace) {
        headers.set("X-ARIA-Trace-Id", incomingTrace);
      }

      const upstream = await fetch(
        new Request(upstreamUrl.toString(), {
          method: request.method,
          headers,
          body:
            request.method === "GET" ||
            request.method === "HEAD"
              ? undefined
              : request.body,
          redirect: "manual"
        })
      );

      if (upstream.status === 401) {
        return rewriteAuthChallenge(upstream);
      }

      return upstream;
    }

    return new Response("ARIA MCP Worker", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
};
