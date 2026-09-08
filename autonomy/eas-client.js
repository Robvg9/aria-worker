'use strict';

const EAS_API = 'https://api.expo.dev';
const EAS_GRAPHQL = `${EAS_API}/graphql`;

function createEasClient({ tokenProvider, fetchImpl = globalThis.fetch } = {}) {
  if (typeof tokenProvider !== 'function') throw new TypeError('tokenProvider required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');

  async function token() {
    const value = await tokenProvider();
    if (typeof value !== 'string' || !value.trim()) throw new Error('eas_credential_unavailable');
    return value.trim();
  }

  async function request(path, init = {}) {
    const accessToken = await token();
    const response = await fetchImpl(`${EAS_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(init.headers || {})
      }
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }
    if (!response.ok) {
      const error = new Error(`eas_http_${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function graphql(query, variables = {}) {
    const accessToken = await token();
    const response = await fetchImpl(EAS_GRAPHQL, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }
    if (!response.ok || body?.errors?.length) {
      const error = new Error(`eas_graphql_${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  const run = async (fn) => fn();

  return Object.freeze({
    async connection_status({ projectId }) {
      return run(() => graphql(
        'query App($appId: String!) { app { byId(appId: $appId) { id name slug ownerAccount { id name } } } }',
        { appId: projectId }
      ));
    },
    async workflow_definitions({ projectId }) {
      return run(() => graphql(
        'query Workflows($appId: String!) { app { byId(appId: $appId) { id workflows { id name fileName createdAt updatedAt revisionsPaginated(first: 1) { edges { node { id blobSha commitSha createdAt yamlConfig } } } } } } }',
        { appId: projectId }
      ));
    },
    async workflow_list({ projectId, limit = 20, status }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
      return run(() => graphql(
        'query Runs($appId: String!, $status: WorkflowRunStatus, $limit: Int!) { app { byId(appId: $appId) { id workflowRunsPaginated(first: $limit, filter: { status: $status }) { edges { node { id status gitCommitMessage gitCommitHash requestedGitRef triggeringLabelName triggerEventType triggeringSchedule createdAt updatedAt errors { title message } workflow { id name fileName } } } } } } }',
        { appId: projectId, status: status || null, limit: safeLimit }
      ));
    },
    async workflow_info({ runId }) {
      return run(() => request(`/v2/workflows/runs/${encodeURIComponent(runId)}`));
    },
    async workflow_dispatch({ projectId, gitRef, fileName, inputs }) {
      return run(() => request('/v2/workflows/dispatch', {
        method: 'POST',
        body: JSON.stringify({ appId: projectId, gitRef, fileName, ...(inputs ? { inputs } : {}) })
      }));
    },
    async build_list({ projectId, limit = 20, offset = 0, platform, status }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
      const safeOffset = Math.max(0, Number(offset) || 0);
      const filters = [];
      if (platform) filters.push(`platform: ${JSON.stringify(String(platform))}`);
      if (status) filters.push(`status: ${JSON.stringify(String(status))}`);
      const filter = filters.length ? `, filter: { ${filters.join(', ')} }` : '';
      return run(() => graphql(
        `query Builds($appId: String!, $offset: Int!, $limit: Int!) { app { byId(appId: $appId) { id builds(offset: $offset, limit: $limit${filter}) { id status platform error { errorCode message docsUrl } artifacts { buildUrl applicationArchiveUrl buildArtifactsUrl xcodeBuildLogsUrl } logFiles buildProfile distribution appIdentifier sdkVersion appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt updatedAt completedAt expirationDate } } } }`,
        { appId: projectId, offset: safeOffset, limit: safeLimit }
      ));
    },
    async build_info({ buildId }) {
      return run(() => graphql(
        'query Build($buildId: ID!) { builds { byId(buildId: $buildId) { id status platform error { errorCode message docsUrl } artifacts { buildUrl applicationArchiveUrl buildArtifactsUrl xcodeBuildLogsUrl } logFiles buildProfile distribution appIdentifier sdkVersion appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt updatedAt completedAt expirationDate } } }',
        { buildId }
      ));
    },
    async build_logs({ buildId }) {
      const info = await run(() => graphql(
        'query Build($buildId: ID!) { builds { byId(buildId: $buildId) { id status logFiles } } }',
        { buildId }
      ));
      const build = info?.data?.builds?.byId || null;
      const logFiles = Array.isArray(build?.logFiles) ? build.logFiles : [];
      const logs = [];
      for (const url of logFiles.slice(0, 10)) {
        if (typeof url !== 'string') continue;
        const response = await fetchImpl(url);
        const text = await response.text();
        logs.push({ url, ok: response.ok, status: response.status, content: text.slice(-50000) });
      }
      return { build, logs };
    }
  });
}

module.exports = Object.freeze({ createEasClient, EAS_API });
