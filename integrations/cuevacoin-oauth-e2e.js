'use strict';

const BASE_PATH = '/oauth/cuevacoin-control-e2e';
const CALLBACK_PATH = BASE_PATH + '/callback';
const FLOW_KEY = 'aria.cuevacoin.control.e2e.pending.v1';
const CLIENT_KEY = 'aria.cuevacoin.control.e2e.client.v1';

const START_SCRIPT = String.raw`(() => {
  "use strict";
  const base = location.origin;
  const resource = base + "/mcp";
  const redirectUri = base + "/oauth/cuevacoin-control-e2e/callback";
  const button = document.getElementById("start");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  function row(label, value) {
    const item = document.createElement("li");
    item.textContent = label + ": " + value;
    results.appendChild(item);
  }
  async function json(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) { return null; }
  }
  function randomB64Url(size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const bytes = new Uint8Array(digest);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    results.replaceChildren();
    status.textContent = "Preparando registro OAuth y PKCE…";
    try {
      let clientId = sessionStorage.getItem("aria.cuevacoin.control.e2e.client.v1");
      if (!clientId) {
        const registrationResponse = await fetch(base + "/register", {
          method: "POST",
          headers: { "content-type": "application/json", "accept": "application/json" },
          body: JSON.stringify({
            client_name: "ARIA CuevaCoin Control E2E Verification",
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "none"
          }),
          cache: "no-store"
        });
        const registration = await json(registrationResponse);
        if (!registrationResponse.ok || !registration || typeof registration.client_id !== "string") {
          throw new Error("client_registration_failed");
        }
        clientId = registration.client_id;
        sessionStorage.setItem("aria.cuevacoin.control.e2e.client.v1", clientId);
      }
      const verifier = randomB64Url(32);
      const challenge = await pkceChallenge(verifier);
      const stateValue = randomB64Url(32);
      sessionStorage.setItem("aria.cuevacoin.control.e2e.pending.v1", JSON.stringify({
        clientId: clientId, redirectUri: redirectUri, resource: resource,
        verifier: verifier, state: stateValue
      }));
      const authorization = new URL(base + "/authorize");
      authorization.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "aria.mcp.inbound aria.project.cuevacoin.control",
        state: stateValue,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: resource
      }).toString();
      status.textContent = "Abriendo el consentimiento explícito de CuevaCoin Control…";
      location.assign(authorization.toString());
    } catch (_) {
      sessionStorage.removeItem("aria.cuevacoin.control.e2e.pending.v1");
      row("Preparación OAuth", "FAIL (registro o PKCE no pudo iniciarse)");
      status.textContent = "No se ha autorizado nada. Recarga esta página para reintentar.";
      button.disabled = false;
    }
  });
})();`;

const CALLBACK_SCRIPT = String.raw`(() => {
  "use strict";
  const base = location.origin;
  const resource = base + "/mcp";
  const callbackPath = "/oauth/cuevacoin-control-e2e/callback";
  const flowKey = "aria.cuevacoin.control.e2e.pending.v1";
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  let accessToken = "";
  let code = "";

  function row(label, value) {
    const item = document.createElement("li");
    item.textContent = label + ": " + value;
    results.appendChild(item);
  }
  async function json(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) {
      const line = text.split(/\r?\n/).find(value => value.startsWith("data: "));
      if (line) { try { return JSON.parse(line.slice(6)); } catch (_) {} }
      return null;
    }
  }
  async function toolCall(token, name, args) {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        "authorization": "Bearer " + token,
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 999999) + 1,
        method: "tools/call",
        params: { name: name, arguments: args || {} }
      }),
      cache: "no-store"
    });
    const payload = await json(response);
    const text = payload && payload.result && Array.isArray(payload.result.content)
      ? payload.result.content.find(item => item.type === "text")?.text : null;
    let inner = null;
    if (text) { try { inner = JSON.parse(text); } catch (_) {} }
    return {
      status: response.status,
      payload: payload,
      inner: inner,
      isError: !!(payload && payload.result && payload.result.isError === true)
    };
  }
  function safeProviderState(value) {
    const allowed = [
      "connected", "connected_read_verified", "not_verified", "not_yet_verified",
      "human_gate", "supabase_management_token_invalid", "supabase_project_permission_denied",
      "supabase_project_unavailable", "github_app_installation_missing",
      "github_app_permission_denied", "github_repository_unavailable",
      "github_app_repository_not_selected", "provider_timeout", "provider_request_failed",
      "scoped_management_token_not_configured", "project_identity_mismatch"
    ];
    return allowed.includes(value) ? value : "unavailable_or_unclassified";
  }

  async function verify() {
    status.textContent = "Validando estado, emisor y destino del callback…";
    try {
      const query = new URLSearchParams(location.search);
      code = query.get("code") || "";
      const returnedState = query.get("state") || "";
      const returnedIssuer = query.get("iss") || "";
      const oauthError = query.get("error") || "";
      history.replaceState(null, "", callbackPath);
      if (oauthError) throw new Error("authorization_denied");
      if (!code) throw new Error("callback_missing_code");
      const raw = sessionStorage.getItem(flowKey);
      if (!raw) throw new Error("pkce_session_missing");
      let flow;
      try { flow = JSON.parse(raw); } catch (_) { throw new Error("pkce_session_invalid"); }
      if (flow.state !== returnedState) throw new Error("oauth_state_mismatch");
      if (returnedIssuer !== base) throw new Error("oauth_issuer_mismatch");
      if (flow.redirectUri !== base + callbackPath || flow.resource !== resource) throw new Error("oauth_target_mismatch");
      sessionStorage.removeItem(flowKey);
      row("Callback, state e issuer", "PASS");
      status.textContent = "Intercambiando el código con PKCE…";

      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: flow.clientId,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
        resource: flow.resource
      });
      flow.verifier = "";
      flow.state = "";
      const tokenResponse = await fetch(base + "/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "accept": "application/json" },
        body: form.toString(),
        cache: "no-store"
      });
      code = "";
      const token = await json(tokenResponse);
      if (!tokenResponse.ok || !token || typeof token.access_token !== "string") {
        const err = token && token.error;
        row("Intercambio de token", "FAIL (" + (["invalid_grant", "invalid_request", "invalid_target"].includes(err) ? err : "HTTP " + tokenResponse.status) + ")");
        throw new Error("token_exchange_failed");
      }

      row("Intercambio de token", "PASS");
      const granted = String(token.scope || "").split(/\s+/).filter(Boolean);
      const scopeOk = granted.includes("aria.project.cuevacoin.control");
      row("Scope aria.project.cuevacoin.control", scopeOk ? "PASS" : "FAIL (no aparece en el token)");
      accessToken = token.access_token;
      token.access_token = "";
      if (typeof token.refresh_token === "string") token.refresh_token = "";
      if (!scopeOk) throw new Error("elevated_scope_missing");

      status.textContent = "Probando herramientas autenticadas de solo lectura…";
      const connection = await toolCall(accessToken, "cuevacoin_connection_status", {});
      if (connection.status === 200 && connection.inner && connection.inner.ok === true) {
        row("Herramienta de estado autenticada", "PASS");
        row("Conexión GitHub", safeProviderState(connection.inner.github && connection.inner.github.state));
        row("Conexión Supabase", safeProviderState(connection.inner.supabase && connection.inner.supabase.state));
        row("Ref de CuevaCoin", connection.inner.project_ref === "zqgmjwfvluboiporytcq" ? "PASS" : "FAIL");
      } else {
        row("Herramienta de estado autenticada", "FAIL (HTTP " + connection.status + ")");
      }

      const control = await toolCall(accessToken, "cuevacoin_project_control", { operation: "github_repo_read" });
      const err = String((control.payload && control.payload.error && control.payload.error.message) || (control.inner && control.inner.error) || "");
      const rejectedByScope = err === "cuevacoin_control_scope_required";
      const scopeGate = control.status === 200 && !rejectedByScope &&
        (control.inner !== null || !!(control.payload && control.payload.result));
      row("Puerta del scope elevado", scopeGate ? "PASS" : "FAIL (scope no aceptado)");
      if (control.inner && control.inner.ok === true) {
        row("Lectura real Robvg9/CuevaCoin", "PASS");
      } else {
        row("Lectura real Robvg9/CuevaCoin", "FAIL (" + safeProviderState(control.inner && control.inner.error) + ")");
      }
      row("Escrituras, SQL o despliegues", "NINGUNO; solo lecturas");
      status.textContent = scopeGate
        ? "Callback OAuth completado. Revisa las comprobaciones individuales para distinguir autorización de disponibilidad de proveedores."
        : "Callback recibido, pero el scope de control no pasó la comprobación.";
    } catch (error) {
      const known = [
        "authorization_denied", "callback_missing_code", "pkce_session_missing",
        "pkce_session_invalid", "oauth_state_mismatch", "oauth_issuer_mismatch",
        "oauth_target_mismatch", "token_exchange_failed", "elevated_scope_missing"
      ];
      const message = error && error.message;
      if (known.includes(message) && !results.textContent.includes("FAIL")) row("Verificación OAuth", "FAIL (" + message + ")");
      status.textContent = "La verificación no terminó. No compartas códigos ni tokens; los resultados visibles indican qué control falló.";
    } finally {
      accessToken = "";
      code = "";
      sessionStorage.removeItem(flowKey);
    }
  }
  void verify();
})();`;

function createCuevacoinOAuthE2E() {
  return function cuevacoinOAuthE2E(request, url) {
    const start = url.pathname === BASE_PATH || url.pathname === BASE_PATH + '/';
    const callback = url.pathname === CALLBACK_PATH;
    if (!start && !callback) return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'allow': 'GET, HEAD' }
    });

    const nonce = globalThis.crypto.randomUUID().replace(/-/g, '');
    const title = 'ARIA · CuevaCoin Control OAuth verification';
    const introduction = callback
      ? 'Validación automática de consentimiento, PKCE, scope elevado y lecturas. Los tokens no se muestran ni se guardan en almacenamiento persistente.'
      : 'Verificación supervisada de OAuth para CuevaCoin Control. Solo ejecuta lecturas; no crea ramas, cambia archivos, ejecuta SQL ni despliega funciones.';
    const button = start ? '<button id="start" type="button">Iniciar autorización correcta</button>' : '';
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>' + title + '</title><style>' +
      ':root{color-scheme:dark;--bg:#080b13;--card:#121827;--line:#293347;--text:#eef2ff;--muted:#a8b2c8;--accent:#8870ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(700px 400px at 50% 0,#1e1a3d,var(--bg) 68%);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);padding:24px}.card{width:min(650px,100%);border:1px solid var(--line);border-radius:20px;background:var(--card);padding:28px;box-shadow:0 22px 70px #0008}h1{font-size:24px;margin:0 0 10px}p{color:var(--muted);line-height:1.6}button{width:100%;margin-top:16px;padding:14px 18px;border:0;border-radius:12px;background:var(--accent);color:white;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#status{margin-top:18px;padding:12px;border:1px solid var(--line);border-radius:10px;color:var(--text)}ol{padding-left:22px;line-height:1.8;overflow-wrap:anywhere}.note{font-size:13px;margin-top:18px}</style></head><body><main class="card"><h1>' + title + '</h1><p>' + introduction + '</p><p>Ámbitos fijos: <code>Robvg9/CuevaCoin</code> y Supabase <code>zqgmjwfvluboiporytcq</code>. La autorización humana sigue siendo obligatoria.</p>' + button + '<div id="status" role="status" aria-live="polite">' + (start ? 'Listo. Pulsa iniciar para abrir la pantalla de consentimiento OAuth.' : 'Procesando el callback OAuth…') + '</div><ol id="results" aria-live="polite"></ol><p class="note">Seguridad: no compartas URLs con códigos ni tokens. Esta verificación no efectúa escrituras de producción.</p><script nonce="' + nonce + '">' + (callback ? CALLBACK_SCRIPT : START_SCRIPT) + '</script></main></body></html>';

    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'cdn-cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'none'; font-src 'none'"
    };
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: headers });
  };
}

module.exports = { createCuevacoinOAuthE2E };
