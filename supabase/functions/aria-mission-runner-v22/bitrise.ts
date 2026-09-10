// Bitrise connector helpers for aria-mission-runner-v22
// Token resolved server-side via the Credential Manager; the value never enters mission state, logs, or results.

export async function bitriseExecute(rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>, step: any) {
  const operation = String(step.operation);
  const input = step.input && typeof step.input === "object" ? step.input : {};
  const readOps = new Set(["bitrise_list_apps","bitrise_get_app","bitrise_get_yml","bitrise_list_builds","bitrise_get_build","bitrise_get_build_log","bitrise_list_artifacts","bitrise_get_artifact"]);
  const writeOps = new Set(["bitrise_trigger_build","bitrise_update_yml"]);
  if (!readOps.has(operation) && !writeOps.has(operation)) {
    throw new Error(`connector_operation_not_allowed:bitrise:${operation}`);
  }
  if (writeOps.has(operation)) {
    const authorization = await rpc("aria_bitrise_authorization_resolve", {
      p_execution_id: String(step.id || operation),
      p_operation: operation,
      p_target: { connector_id: "bitrise", app_slug: input.app_slug ?? null },
      p_risk_class: operation === "bitrise_update_yml" ? "HIGH_RISK_WRITE" : "LOW_RISK_WRITE",
    });
    if (!authorization || typeof authorization !== "object") {
      throw new Error(`authorization_required:${operation === "bitrise_update_yml" ? "HIGH_RISK_WRITE" : "LOW_RISK_WRITE"}`);
    }
    const status = String((authorization as any).status || "");
    if (status !== "approved") {
      const authorizationId = String((authorization as any).authorization_id || "");
      throw new Error(`human_gate_required:${authorizationId || "pending"}`);
    }
  }
  const data = await rpc("aria_bitrise_credential_read_secret", { p_name: "bitrise_api_token" });
  let token = "";
  if (typeof data === "string" && data) token = data;
  else if (data && typeof (data as any).secret === "string") token = (data as any).secret;
  if (!token) throw new Error("credential_unconfigured:bitrise_api_token");
  const api = async (path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { Authorization: token, Accept: "application/json", ...(init.headers as Record<string, string> || {}) };
    const res = await fetch(`https://api.bitrise.io/v0.1${path}`, { ...init, headers });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text ? { raw: text.slice(0, 20000) } : null; }
    if (!res.ok) throw new Error(`bitrise_http_${res.status}`);
    return body;
  };
  const app = encodeURIComponent(String(input.app_slug || ""));
  const build = encodeURIComponent(String(input.build_slug || ""));
  const artifact = encodeURIComponent(String(input.artifact_slug || ""));
  let result: unknown;
  if (operation === "bitrise_list_apps") result = await api("/apps");
  else if (operation === "bitrise_get_app") { if (!input.app_slug) throw new Error("app_slug_required"); result = await api(`/apps/${app}`); }
  else if (operation === "bitrise_get_yml") { if (!input.app_slug) throw new Error("app_slug_required"); result = await api(`/apps/${app}/bitrise.yml`); }
  else if (operation === "bitrise_list_builds") { if (!input.app_slug) throw new Error("app_slug_required"); result = await api(`/apps/${app}/builds`); }
  else if (operation === "bitrise_get_build") { if (!input.app_slug || !input.build_slug) throw new Error("app_slug_and_build_slug_required"); result = await api(`/apps/${app}/builds/${build}`); }
  else if (operation === "bitrise_get_build_log") { if (!input.app_slug || !input.build_slug) throw new Error("app_slug_and_build_slug_required"); result = await api(`/apps/${app}/builds/${build}/log`); }
  else if (operation === "bitrise_list_artifacts") { if (!input.app_slug || !input.build_slug) throw new Error("app_slug_and_build_slug_required"); result = await api(`/apps/${app}/builds/${build}/artifacts`); }
  else if (operation === "bitrise_get_artifact") { if (!input.app_slug || !input.build_slug || !input.artifact_slug) throw new Error("app_slug_build_slug_artifact_slug_required"); result = await api(`/apps/${app}/builds/${build}/artifacts/${artifact}`); }
  else if (operation === "bitrise_trigger_build") {
    if (!input.app_slug) throw new Error("app_slug_required");
    if (!input.branch) throw new Error("branch_required");
    const build_params: Record<string, string> = { branch: String(input.branch) };
    if (input.commit_hash) build_params.commit_hash = String(input.commit_hash);
    if (input.workflow_id) build_params.workflow_id = String(input.workflow_id);
    if (input.pipeline_id) build_params.pipeline_id = String(input.pipeline_id);
    result = await api(`/apps/${app}/builds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hook_info: { type: "bitrise" }, build_params }) });
  } else if (operation === "bitrise_update_yml") {
    if (!input.app_slug) throw new Error("app_slug_required");
    const yml = input.yml ?? input.app_config_datastore_yaml;
    if (yml === undefined || yml === null) throw new Error("yml_required");
    result = await api(`/apps/${app}/bitrise.yml`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_config_datastore_yaml: yml }) });
  }
  return { status: "succeeded", executor_type: "connector", connector_id: "bitrise", operation, data: result };
}
