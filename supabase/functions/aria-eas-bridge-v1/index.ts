import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const EXPO_TOKEN = Deno.env.get("EXPO_TOKEN") ?? "";
const EAS_API = "https://api.expo.dev";
const EAS_GRAPHQL = `${EAS_API}/graphql`;
const APP_ID = "1b23b091-f7b6-4dc2-b328-c8e5ec07de57";
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const ok = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const error = (status: number, code: string, message: string, details?: unknown) =>
  ok({ error: code, message, ...(details === undefined ? {} : { details }) }, status);

async function authenticate(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: authError } = await client.auth.getUser(token);
  if (authError || !data.user) return null;
  return data.user;
}

function easHeaders() {
  if (!EXPO_TOKEN) throw new Error("EXPO_TOKEN is not configured");
  return { authorization: `Bearer ${EXPO_TOKEN}`, "content-type": "application/json" };
}

async function easGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(EAS_GRAPHQL, {
    method: "POST",
    headers: easHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 4000) }; }
  return { status: response.status, body };
}

async function easRest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${EAS_API}${path}`, {
    ...init,
    headers: { ...easHeaders(), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }
  return { status: response.status, body };
}

const WORKFLOW_FRAGMENT = `
  id
  name
  fileName
  createdAt
  updatedAt
  revisionsPaginated(first: 1) {
    edges { node { id blobSha commitSha createdAt yamlConfig } }
  }
`;

const RUN_FRAGMENT = `
  id
  status
  gitCommitMessage
  gitCommitHash
  requestedGitRef
  actor { id __typename ... on UserActor { username } ... on Robot { firstName } }
  triggeringLabelName
  triggerEventType
  triggeringSchedule
  createdAt
  updatedAt
  errors { title message }
  workflow { id name fileName }
`;

const BUILD_FRAGMENT = `
  id status platform
  error { errorCode message docsUrl }
  artifacts { buildUrl xcodeBuildLogsUrl applicationArchiveUrl buildArtifactsUrl }
  fingerprint { id hash }
  initiatingActor { __typename id displayName }
  logFiles
  app { __typename id name slug ownerAccount { id name } }
  updateChannel { id name }
  distribution iosEnterpriseProvisioning buildProfile appIdentifier sdkVersion appVersion appBuildVersion
  runtime { id version }
  gitCommitHash gitCommitMessage initialQueuePosition queuePosition estimatedWaitTimeLeftSeconds priority
  createdAt updatedAt message completedAt expirationDate isForIosSimulator
  metrics { buildWaitTime buildQueueTime buildDuration }
`;

async function connectionStatus() {
  const result = await easGraphQL(`query App($appId: String!) { app { byId(appId: $appId) { id name slug ownerAccount { id name } } } }`, { appId: APP_ID });
  return { appId: APP_ID, ...result.body };
}

async function workflowList(limit = 20, status?: string) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const query = `query Runs($appId: String!, $status: WorkflowRunStatus, $limit: Int!) { app { byId(appId: $appId) { id workflowRunsPaginated(first: $limit, filter: { status: $status }) { edges { node { ${RUN_FRAGMENT} } } } } } }`;
  const result = await easGraphQL(query, { appId: APP_ID, status: status || null, limit: safeLimit });
  return result.body;
}

async function workflowDefinitionList() {
  const query = `query Workflows($appId: String!) { app { byId(appId: $appId) { id workflows { ${WORKFLOW_FRAGMENT} } } } }`;
  const result = await easGraphQL(query, { appId: APP_ID });
  return result.body;
}

async function workflowInfo(runId: string) {
  const result = await easRest(`/v2/workflows/runs/${encodeURIComponent(runId)}`);
  return result.body;
}

async function workflowDispatch(gitRef: string, fileName: string, inputs?: Record<string, unknown>) {
  const result = await easRest(`/v2/workflows/dispatch`, {
    method: "POST",
    body: JSON.stringify({ appId: APP_ID, gitRef, fileName, ...(inputs ? { inputs } : {}) }),
  });
  return result.body;
}

async function buildList(limit = 20, offset = 0, platform?: string, status?: string) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const filterParts: string[] = [];
  if (platform) filterParts.push(`platform: ${JSON.stringify(platform)}`);
  if (status) filterParts.push(`status: ${JSON.stringify(status)}`);
  const filter = filterParts.length ? `, filter: { ${filterParts.join(", ")} }` : "";
  const query = `query Builds($appId: String!, $offset: Int!, $limit: Int!) { app { byId(appId: $appId) { id builds(offset: $offset, limit: $limit${filter}) { ${BUILD_FRAGMENT} } } } }`;
  const result = await easGraphQL(query, { appId: APP_ID, offset: safeOffset, limit: safeLimit });
  return result.body;
}

async function buildInfo(buildId: string) {
  const query = `query Build($buildId: ID!) { builds { byId(buildId: $buildId) { ${BUILD_FRAGMENT} } } }`;
  const result = await easGraphQL(query, { buildId });
  return result.body;
}

async function buildLogs(buildId: string) {
  const info = await buildInfo(buildId);
  const logFiles = info?.data?.builds?.byId?.logFiles;
  if (!Array.isArray(logFiles) || logFiles.length === 0) return { buildId, logs: [], build: info?.data?.builds?.byId ?? null };
  const logs = [];
  for (const url of logFiles.slice(0, 10)) {
    if (typeof url !== "string") continue;
    try {
      const response = await fetch(url);
      const text = await response.text();
      logs.push({ url, ok: response.ok, status: response.status, content: text.slice(-50000) });
    } catch (e) {
      logs.push({ url, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { buildId, build: info?.data?.builds?.byId ?? null, logs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" } });
  if (req.method !== "POST") return error(405, "method_not_allowed", "POST required");
  const user = await authenticate(req);
  if (!user) return error(401, "unauthorized", "Valid Supabase user token required");
  if (!EXPO_TOKEN) return error(503, "eas_token_not_configured", "EXPO_TOKEN is not configured server-side");

  let body: any;
  try { body = await req.json(); } catch { return error(400, "invalid_json", "Request body must be JSON"); }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "connection_status":
        return ok({ action, actor_user_id: user.id, result: await connectionStatus() });
      case "workflow_definitions":
        return ok({ action, actor_user_id: user.id, result: await workflowDefinitionList() });
      case "workflow_list":
        return ok({ action, actor_user_id: user.id, result: await workflowList(body.limit, body.status) });
      case "workflow_info":
        if (typeof body.runId !== "string" || !body.runId.trim()) return error(400, "run_id_required", "runId is required");
        return ok({ action, actor_user_id: user.id, result: await workflowInfo(body.runId.trim()) });
      case "workflow_dispatch":
        if (body.confirm !== true) return error(412, "confirmation_required", "workflow_dispatch requires confirm=true");
        if (typeof body.gitRef !== "string" || !body.gitRef.trim()) return error(400, "git_ref_required", "gitRef is required");
        if (typeof body.fileName !== "string" || !body.fileName.trim()) return error(400, "file_name_required", "fileName is required");
        return ok({ action, actor_user_id: user.id, result: await workflowDispatch(body.gitRef.trim(), body.fileName.trim(), body.inputs && typeof body.inputs === "object" ? body.inputs : undefined) });
      case "build_list":
        return ok({ action, actor_user_id: user.id, result: await buildList(body.limit, body.offset, body.platform, body.status) });
      case "build_info":
        if (typeof body.buildId !== "string" || !body.buildId.trim()) return error(400, "build_id_required", "buildId is required");
        return ok({ action, actor_user_id: user.id, result: await buildInfo(body.buildId.trim()) });
      case "build_logs":
        if (typeof body.buildId !== "string" || !body.buildId.trim()) return error(400, "build_id_required", "buildId is required");
        return ok({ action, actor_user_id: user.id, result: await buildLogs(body.buildId.trim()) });
      default:
        return error(400, "unknown_action", "Unsupported EAS bridge action", { action });
    }
  } catch (e) {
    return error(502, "eas_upstream_error", "EAS upstream request failed", { message: e instanceof Error ? e.message : String(e) });
  }
});
