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
  let writeProbeReady = false;
  let writeProbeRunning = false;
  let probeEvidence = null;
  const writeProbeButton = document.getElementById("run-write-probe");
  const evidenceButton = document.getElementById("download-evidence");

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

  function safeProbeError(error) {
    return String(error && error.message || error || "unknown_error")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[JWT REDACTED]")
      .replace(/([?&](?:code|state|access_token|refresh_token)=)[^&\s]+/gi, "$1[REDACTED]")
      .slice(0, 180);
  }
  async function projectControl(operation, args) {
    const result = await toolCall(accessToken, "cuevacoin_project_control", Object.assign({ operation: operation }, args || {}));
    const errorText = String((result.inner && result.inner.error) ||
      (result.payload && result.payload.error && result.payload.error.message) || "tool_error");
    if (result.status !== 200 || result.isError || !result.inner || result.inner.ok !== true) {
      throw new Error(operation + "_FAILED_" + errorText);
    }
    return result.inner;
  }
  function enableEvidenceDownload() {
    evidenceButton.hidden = !probeEvidence;
  }
  function downloadProbeEvidence() {
    if (!probeEvidence) return;
    const blob = new Blob([JSON.stringify(probeEvidence, null, 2) + "\n"], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "aria-cuevacoin-step5-write-probe-" + probeEvidence.probe_id + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
  }
  evidenceButton.addEventListener("click", downloadProbeEvidence);
  writeProbeButton.addEventListener("click", async function () {
    if (!writeProbeReady || writeProbeRunning || !accessToken) return;
    writeProbeRunning = true;
    writeProbeButton.disabled = true;
    const random = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(function (value) { return value.toString(16).padStart(2, "0"); }).join("");
    const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const probeId = dateTag + "-" + random;
    const branch = "aria/repair/cuevacoin-probe-" + probeId;
    const filePath = "docs/evidence/aria-step5-write-probe-" + probeId + ".md";
    const started = new Date().toISOString();
    const fileContent = [
      "# Temporary ARIA GitHub App write probe",
      "",
      "Purpose: verify the governed ARIA runtime can create and clean a harmless branch, evidence-only file, and pull request.",
      "No product code, customer data, credentials, SQL, financial operations, merge, or deployment is permitted.",
      "Do not merge. This probe must be closed and its branch deleted after verification.",
      "Created at UTC: " + started,
      "Probe id: " + probeId,
      ""
    ].join("\n");
    probeEvidence = {
      schema: "aria-cuevacoin-step5-write-probe-browser-v1",
      started_at_utc: started,
      repository: "Robvg9/CuevaCoin",
      project_ref: "zqgmjwfvluboiporytcq",
      transport: "same-origin HTTPS OAuth callback through ARIA Worker",
      probe_id: probeId,
      branch: branch,
      file_path: filePath,
      no_merge_requested: true,
      no_financial_operations: true,
      stages: {},
      cleanup: {
        pr_close_confirmed: false,
        closed_pr_state_verified: false,
        branch_delete_confirmed: false,
        branch_absence_verified: false
      },
      final_status: "IN_PROGRESS"
    };
    let stage = "main_ref_precheck";
    let mainSha = "";
    let commitSha = "";
    let prNumber = null;
    let prUrl = "";
    let branchCreated = false;
    let prClosed = false;
    let branchDeleted = false;
    async function runStage(stageName, operation, args) {
      stage = stageName;
      status.textContent = "Prueba GitHub: " + stageName + "…";
      const result = await projectControl(operation, args);
      probeEvidence.stages[stageName] = { ok: true, completed_at_utc: new Date().toISOString() };
      row(stageName, "PASS");
      return result;
    }
    try {
      const mainRef = await runStage("main_ref_precheck", "github_ref_read", { branch: "main" });
      mainSha = String(mainRef.data && mainRef.data.sha || "");
      if (!/^[a-f0-9]{40}$/i.test(mainSha)) throw new Error("main_sha_invalid");
      probeEvidence.main_sha_before = mainSha;

      const beforeFind = await runStage("probe_pr_precheck", "github_pr_find", { branch: branch, base: "main", state: "all" });
      if (!beforeFind.data || !Array.isArray(beforeFind.data.items) || beforeFind.data.items.length !== 0) {
        throw new Error("probe_pr_branch_conflict");
      }

      await runStage("create_branch", "github_create_branch", { branch: branch, ref: "main" });
      branchCreated = true;
      const branchRef = await runStage("verify_branch_base", "github_ref_read", { branch: branch });
      const branchSha = String(branchRef.data && branchRef.data.sha || "");
      if (!branchSha || branchSha !== mainSha) throw new Error("branch_base_sha_mismatch");
      probeEvidence.branch_base_sha_verified = true;

      const fileWrite = await runStage("write_harmless_file", "github_file_write", {
        branch: branch,
        path: filePath,
        content: fileContent,
        message: "test: verify ARIA governed CuevaCoin write path",
        risk_level: "low"
      });
      commitSha = String(fileWrite.data && fileWrite.data.commit_sha || "");
      if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("file_write_commit_sha_missing");
      probeEvidence.file_commit_sha = commitSha;

      const fileRead = await runStage("verify_file_readback", "github_file_read", { branch: branch, path: filePath });
      const actualB64 = String(fileRead.data && fileRead.data.content || "").replace(/\s+/g, "");
      const expectedB64 = btoa(unescape(encodeURIComponent(fileContent)));
      if (!actualB64 || actualB64 !== expectedB64) throw new Error("file_readback_content_mismatch");
      probeEvidence.file_readback_verified = true;

      const opened = await runStage("open_temporary_pr", "github_open_pr", {
        branch: branch,
        base: "main",
        title: "[TEMPORARY NO-MERGE] ARIA CuevaCoin step 5 write probe " + probeId,
        body: [
          "Temporary verification PR for /ARIA-CuevaCoin step 5.",
          "",
          "- Created through the same-origin HTTPS ARIA OAuth callback and authenticated MCP project-control tool.",
          "- Contains only a harmless evidence-only text file; no product code, customer data, credentials, SQL, financial operations, or deployment changes.",
          "- DO NOT MERGE. This PR is closed and the temporary branch is deleted after verification.",
          "- Probe ID: " + probeId,
          "- Expected base: main at " + mainSha + "."
        ].join("\n")
      });
      const openedPr = opened.data || {};
      prNumber = Number(openedPr.number);
      prUrl = String(openedPr.url || "");
      if (!Number.isInteger(prNumber) || prNumber < 1 ||
          !prUrl.startsWith("https://github.com/Robvg9/CuevaCoin/pull/")) {
        throw new Error("pr_number_or_url_invalid");
      }
      probeEvidence.pull_request = { number: prNumber, url: prUrl };

      const prRead = await runStage("verify_open_pr", "github_pr_read", { number: prNumber });
      const currentPr = prRead.data || {};
      const prChecks = {
        number_matches: Number(currentPr.number) === prNumber,
        open: String(currentPr.state) === "open",
        not_merged: currentPr.merged === false,
        head_branch_matches: String(currentPr.head_ref) === branch,
        base_main: String(currentPr.base_ref) === "main",
        head_sha_matches_file_commit: String(currentPr.head_sha) === commitSha
      };
      probeEvidence.pull_request.verification = prChecks;
      probeEvidence.pull_request.head_sha = String(currentPr.head_sha || "");
      probeEvidence.pull_request.base_sha = String(currentPr.base_sha || "");
      if (Object.values(prChecks).some(function (value) { return value !== true; })) {
        throw new Error("pr_verification_mismatch");
      }

      const close = await runStage("close_pr_without_merge", "github_pr_close", {
        number: prNumber, branch: branch, confirm_cleanup: true
      });
      if (!close.data || String(close.data.state) !== "closed" || close.data.merged === true) {
        throw new Error("probe_pr_close_not_confirmed");
      }
      prClosed = true;
      probeEvidence.cleanup.pr_close_confirmed = true;
      probeEvidence.cleanup.merged = false;

      const closedRead = await runStage("verify_closed_pr", "github_pr_read", { number: prNumber });
      const closedPr = closedRead.data || {};
      if (String(closedPr.state) !== "closed" || closedPr.merged !== false ||
          String(closedPr.head_ref) !== branch || String(closedPr.base_ref) !== "main") {
        throw new Error("closed_pr_state_mismatch");
      }
      probeEvidence.cleanup.closed_pr_state_verified = true;

      const deletion = await runStage("delete_probe_branch", "github_branch_delete", {
        branch: branch, confirm_cleanup: true
      });
      if (!deletion.data || deletion.data.deleted !== true) throw new Error("probe_branch_delete_not_confirmed");
      branchDeleted = true;
      probeEvidence.cleanup.branch_delete_confirmed = true;
      probeEvidence.cleanup.deleted_branch_previous_sha = String(deletion.data.previous_sha || "");

      stage = "verify_branch_absent";
      status.textContent = "Verificando que la rama temporal ya no existe…";
      const absentResult = await toolCall(accessToken, "cuevacoin_project_control", {
        operation: "github_ref_read", branch: branch
      });
      const absentError = String((absentResult.inner && absentResult.inner.error) ||
        (absentResult.payload && absentResult.payload.error && absentResult.payload.error.message) || "");
      if (absentResult.status === 200 && !absentResult.isError &&
          absentResult.inner && absentResult.inner.ok === true) {
        throw new Error("probe_branch_still_exists_after_delete");
      }
      if (!/github_404|not found|reference does not exist/i.test(absentError)) {
        throw new Error("probe_branch_absence_not_proven");
      }
      probeEvidence.stages.verify_branch_absent = { ok: true, completed_at_utc: new Date().toISOString() };
      probeEvidence.cleanup.branch_absence_verified = true;
      probeEvidence.cleanup.completed_at_utc = new Date().toISOString();
      row("verify_branch_absent", "PASS");

      probeEvidence.final_status = "PASS";
      probeEvidence.finished_at_utc = new Date().toISOString();
      status.textContent = "Paso 5: prueba GitHub E2E PASS. PR cerrada sin merge y rama temporal eliminada.";
      row("Resultado terminal", "PASS; sin merge, sin deploy y sin operaciones financieras");
    } catch (error) {
      probeEvidence.failed_stage = stage;
      probeEvidence.safe_error = safeProbeError(error);
      probeEvidence.final_status = "BLOCKED_OR_FAILED";
      probeEvidence.finished_at_utc = new Date().toISOString();
      row("Resultado terminal", "BLOCKED_OR_FAILED en " + stage);
      status.textContent = "La prueba se detuvo en " + stage + ". Descarga la evidencia JSON; revisa la limpieza antes de reintentar.";
    } finally {
      // Best-effort cleanup keeps the probe non-merged and prevents leaving a test branch behind.
      if (probeEvidence.final_status !== "PASS" && accessToken) {
        if (prNumber && !prClosed) {
          try {
            const close = await projectControl("github_pr_close", { number: prNumber, branch: branch, confirm_cleanup: true });
            if (close.data && String(close.data.state) === "closed" && close.data.merged !== true) {
              prClosed = true;
              probeEvidence.cleanup.pr_close_confirmed = true;
              probeEvidence.cleanup.merged = false;
            }
          } catch (cleanupError) {
            probeEvidence.cleanup.pr_close_error = safeProbeError(cleanupError);
          }
        }
        if (branchCreated && !branchDeleted) {
          try {
            const deletion = await projectControl("github_branch_delete", { branch: branch, confirm_cleanup: true });
            if (deletion.data && deletion.data.deleted === true) {
              branchDeleted = true;
              probeEvidence.cleanup.branch_delete_confirmed = true;
              probeEvidence.cleanup.deleted_branch_previous_sha = String(deletion.data.previous_sha || "");
            }
          } catch (cleanupError) {
            probeEvidence.cleanup.branch_delete_error = safeProbeError(cleanupError);
          }
        }
        if (branchCreated) {
          try {
            const check = await toolCall(accessToken, "cuevacoin_project_control", { operation: "github_ref_read", branch: branch });
            const checkError = String((check.inner && check.inner.error) || (check.payload && check.payload.error && check.payload.error.message) || "");
            if ((check.isError || !check.inner || check.inner.ok !== true) &&
                /github_404|not found|reference does not exist/i.test(checkError)) {
              probeEvidence.cleanup.branch_absence_verified = true;
            }
          } catch (cleanupError) {
            probeEvidence.cleanup.branch_absence_error = safeProbeError(cleanupError);
          }
        }
        probeEvidence.finished_at_utc = new Date().toISOString();
      }
      writeProbeRunning = false;
      writeProbeReady = false;
      accessToken = "";
      code = "";
      writeProbeButton.disabled = true;
      evidenceButton.hidden = false;
      enableEvidenceDownload();
      downloadProbeEvidence();
    }
  });
  window.addEventListener("pagehide", function () {
    accessToken = "";
    code = "";
  });

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
      const projectIdentityOk = !!(connection.inner && connection.inner.project_ref === "zqgmjwfvluboiporytcq");
      const repositoryReadOk = !!(control.inner && control.inner.ok === true);
      if (scopeGate && projectIdentityOk && repositoryReadOk) {
        writeProbeReady = true;
        writeProbeButton.hidden = false;
        writeProbeButton.disabled = false;
        row("Prueba de escritura GitHub", "LISTA; requiere un clic separado para crear y limpiar una rama, archivo y PR de prueba");
        row("Límites", "Sin merge, sin deploy, sin SQL y sin operaciones financieras");
        status.textContent = "OAuth verificado. Cuando estés listo, usa el botón separado para ejecutar la prueba GitHub temporal; no es automática.";
      } else {
        writeProbeReady = false;
        accessToken = "";
        row("Prueba de escritura GitHub", "BLOQUEADA: falta verificación de scope, repositorio o identidad de proyecto");
        status.textContent = "Callback recibido, pero los gates de scope/identidad/lectura no pasaron. No se habilitó ninguna escritura.";
      }
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
      code = "";
      sessionStorage.removeItem(flowKey);
      if (!writeProbeReady) accessToken = "";
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
      ? 'OAuth con PKCE y scope elevado. Tras la lectura autenticada, una prueba GitHub inocua se ofrece mediante un segundo botón explícito.'
      : 'Inicia el consentimiento desde esta página. El callback vuelve a este mismo dominio HTTPS; no usa localhost ni otro dispositivo.';
    const button = start ? '<button id="start" type="button">Iniciar autorización correcta</button>' : '';
    const probeControls = callback
      ? '<button id="run-write-probe" type="button" hidden>Ejecutar prueba GitHub controlada (sin merge)</button><button id="download-evidence" type="button" hidden>Descargar evidencia JSON</button>'
      : '';
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>' + title + '</title><style>' +
      ':root{color-scheme:dark;--bg:#080b13;--card:#121827;--line:#293347;--text:#eef2ff;--muted:#a8b2c8;--accent:#8870ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(700px 400px at 50% 0,#1e1a3d,var(--bg) 68%);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);padding:24px}.card{width:min(650px,100%);border:1px solid var(--line);border-radius:20px;background:var(--card);padding:28px;box-shadow:0 22px 70px #0008}h1{font-size:24px;margin:0 0 10px}p{color:var(--muted);line-height:1.6}button{width:100%;margin-top:16px;padding:14px 18px;border:0;border-radius:12px;background:var(--accent);color:white;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}button[hidden]{display:none}#status{margin-top:18px;padding:12px;border:1px solid var(--line);border-radius:10px;color:var(--text)}ol{padding-left:22px;line-height:1.8;overflow-wrap:anywhere}.note{font-size:13px;margin-top:18px}</style></head><body><main class="card"><h1>' + title + '</h1><p>' + introduction + '</p><p>Ámbitos fijos: <code>Robvg9/CuevaCoin</code> y Supabase <code>zqgmjwfvluboiporytcq</code>. La autorización humana sigue siendo obligatoria.</p>' + button + probeControls + '<div id="status" role="status" aria-live="polite">' + (start ? 'Listo. Pulsa iniciar para abrir la pantalla de consentimiento OAuth.' : 'Procesando el callback OAuth…') + '</div><ol id="results" aria-live="polite"></ol><p class="note">Seguridad: sin operaciones financieras, SQL ni deploy. La prueba opcional crea y elimina una rama temporal y una PR que se cierra sin merge.</p><script nonce="' + nonce + '">' + (callback ? CALLBACK_SCRIPT : START_SCRIPT) + '</script></main></body></html>';

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
