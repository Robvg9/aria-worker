'use strict';

const fs = require('fs');

const file = process.argv[2] || 'supabase/functions/aria-mission-runner-v22/index.ts';
const source = fs.readFileSync(file, 'utf8');

if (source.includes('const EAS_PROJECT_ID =')) {
  console.log('EAS runner patch already present');
  process.exit(0);
}

const constantsNeedle = 'const AGENT = `${URL}/functions/v1/aria-agent-runtime-v1`;';
const constantsPatch = [
  constantsNeedle,
  "const EAS_API = 'https://api.expo.dev';",
  "const EAS_TOKEN = Deno.env.get('EXPO_TOKEN') ?? '';",
  "const EAS_PROJECT_ID = '1b23b091-f7b6-4dc2-b328-c8e5ec07de57';"
].join('\n');

let output = source.replace(constantsNeedle, constantsPatch);
if (output === source) throw new Error('EAS constants anchor not found');

const typeNeedle = '["connector", "device", "model", "agent"]';
output = output.replace(typeNeedle, '["connector", "device", "model", "agent", "eas"]');
if (!output.includes('["connector", "device", "model", "agent", "eas"]')) throw new Error('EAS executor type anchor not found');

const validationNeedle = 'if (type === "agent" && !step.target?.agent_id) throw new Error("agent_target_missing");';
const validationPatch = [
  validationNeedle,
  '  if (type === "eas" && String(step.target?.project_id || "") !== EAS_PROJECT_ID) throw new Error("eas_project_target_mismatch");'
].join('\n');
output = output.replace(validationNeedle, validationPatch);
if (!output.includes('eas_project_target_mismatch')) throw new Error('EAS validation anchor not found');

const executeNeedle = 'async function executeStep(missionId: string, step: any, token: string | null) {';
const easBlock = [
  'async function easGraphQL(query: string, variables: Record<string, unknown> = {}) {',
  '  if (!EAS_TOKEN) throw new Error("eas_credential_unavailable");',
  '  const response = await fetch(EAS_API + "/graphql", {',
  '    method: "POST",',
  '    headers: { authorization: "Bearer " + EAS_TOKEN, "content-type": "application/json" },',
  '    body: JSON.stringify({ query, variables }),',
  '  });',
  '  const text = await response.text();',
  '  let body: any;',
  '  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }',
  '  if (!response.ok || body?.errors?.length) throw new Error("eas_graphql_" + response.status);',
  '  return body;',
  '}',
  '',
  'async function easRest(path: string, init: RequestInit = {}) {',
  '  if (!EAS_TOKEN) throw new Error("eas_credential_unavailable");',
  '  const response = await fetch(EAS_API + path, {',
  '    ...init,',
  '    headers: { authorization: "Bearer " + EAS_TOKEN, "content-type": "application/json", ...(init.headers || {}) },',
  '  });',
  '  const text = await response.text();',
  '  let body: any;',
  '  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }',
  '  if (!response.ok) throw new Error("eas_http_" + response.status);',
  '  return body;',
  '}',
  '',
  'async function easExecute(step: any) {',
  '  const operation = String(step.operation || "");',
  '  const projectId = String(step.target?.project_id || "");',
  '  if (projectId !== EAS_PROJECT_ID) throw new Error("eas_project_target_mismatch");',
  '  if (operation === "eas.connection_status") return { data: await easGraphQL("query App($appId: String!) { app { byId(appId: $appId) { id name slug ownerAccount { id name } } } }", { appId: projectId }), status: "succeeded", executor_type: "eas", operation, project_id: projectId };',
  '  if (operation === "eas.workflow_definitions") return { data: await easGraphQL("query Workflows($appId: String!) { app { byId(appId: $appId) { id workflows { id name fileName createdAt updatedAt } } } }", { appId: projectId }), status: "succeeded", executor_type: "eas", operation, project_id: projectId };',
  '  if (operation === "eas.workflow_list") { const limit = Math.max(1, Math.min(Number(step.input?.limit) || 20, 100)); const status = typeof step.input?.status === "string" ? step.input.status : null; return { data: await easGraphQL("query Runs($appId: String!, $status: WorkflowRunStatus, $limit: Int!) { app { byId(appId: $appId) { id workflowRunsPaginated(first: $limit, filter: { status: $status }) { edges { node { id status gitCommitHash requestedGitRef createdAt updatedAt errors { title message } workflow { id name fileName } } } } } } }", { appId: projectId, status, limit }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }',
  '  if (operation === "eas.workflow_info") { const runId = String(step.input?.runId || ""); if (!runId) throw new Error("eas_run_id_required"); return { data: await easRest("/v2/workflows/runs/" + encodeURIComponent(runId)), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }',
  '  if (operation === "eas.workflow_dispatch") { const confirm = step.confirm === true || step.input?.confirm === true; if (!confirm) return { status: "blocked", executor_type: "eas", operation, project_id: projectId, error: { code: "confirmation_required", message: "workflow dispatch requires confirm=true" } }; const gitRef = String(step.input?.gitRef || ""); const fileName = String(step.input?.fileName || ""); if (!gitRef || !fileName) throw new Error("eas_dispatch_input_missing"); return { data: await easRest("/v2/workflows/dispatch", { method: "POST", body: JSON.stringify({ appId: projectId, gitRef, fileName, ...(step.input?.inputs ? { inputs: step.input.inputs } : {}) }) }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }',
  '  if (operation === "eas.build_list") { const limit = Math.max(1, Math.min(Number(step.input?.limit) || 20, 50)); const offset = Math.max(0, Number(step.input?.offset) || 0); return { data: await easGraphQL("query Builds($appId: String!, $offset: Int!, $limit: Int!) { app { byId(appId: $appId) { id builds(offset: $offset, limit: $limit) { id status platform error { errorCode message docsUrl } artifacts { buildUrl applicationArchiveUrl buildArtifactsUrl } logFiles buildProfile appIdentifier sdkVersion appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt updatedAt completedAt } } } }", { appId: projectId, offset, limit }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }',
  '  if (operation === "eas.build_info") { const buildId = String(step.input?.buildId || ""); if (!buildId) throw new Error("eas_build_id_required"); return { data: await easGraphQL("query Build($buildId: ID!) { builds { byId(buildId: $buildId) { id status platform error { errorCode message docsUrl } artifacts { buildUrl applicationArchiveUrl buildArtifactsUrl } logFiles buildProfile appIdentifier sdkVersion appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt updatedAt completedAt } } }", { buildId }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }',
  '  if (operation === "eas.build_logs") { const buildId = String(step.input?.buildId || ""); if (!buildId) throw new Error("eas_build_id_required"); const info = await easGraphQL("query Build($buildId: ID!) { builds { byId(buildId: $buildId) { id status logFiles } } }", { buildId }); const build = info?.data?.builds?.byId || null; const logs = []; for (const url of Array.isArray(build?.logFiles) ? build.logFiles.slice(0, 10) : []) { if (typeof url !== "string") continue; const response = await fetch(url); logs.push({ url, ok: response.ok, status: response.status, content: (await response.text()).slice(-50000) }); } return { build, logs, status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }',
  '  throw new Error("eas_operation_not_supported:" + operation);',
  '}',
  '',
  executeNeedle
].join('\n');
output = output.replace(executeNeedle, easBlock);
if (!output.includes('async function easExecute(step: any)')) throw new Error('EAS execute block insertion failed');

const routeNeedle = 'if (type === "agent") return agentExecute(missionId, step, token);';
output = output.replace(routeNeedle, routeNeedle + '\n  if (type === "eas") return easExecute(step);');
if (!output.includes('if (type === "eas") return easExecute(step);')) throw new Error('EAS route anchor not found');

fs.writeFileSync(file, output);
console.log('EAS runner patch transformer PASS');
