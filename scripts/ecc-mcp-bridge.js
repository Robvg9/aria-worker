'use strict';

const crypto = require('node:crypto');

const ECC_MCP_PATH = 'mcp-configs/mcp-servers.json';
const ECC_MCP_SHA = 'f3d607bd719ebfb44e3b0e6be5acc4734ee65edf';
const MAX_ENABLED_MCP = 9;

function hasPlaceholder(value) {
  return typeof value === 'string' && (
    /YOUR_[A-Z0-9_]+_HERE/.test(value) ||
    /YOUR_[A-Z0-9_]+/.test(value) ||
    /ABSOLUTE\/PATH|\/path\/to\//i.test(value)
  );
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, out));
  return out;
}

function classifyTransport(server) {
  return server && server.type === 'http' ? 'http' : 'stdio';
}

function classifyReadiness(server) {
  const strings = collectStrings(server);
  const placeholders = strings.some(hasPlaceholder);
  const explicitOptIn = /opt-in|not enabled by default|disabled by default/i.test(strings.join(' '));
  if (placeholders) return 'BLOCKED_CONFIGURATION';
  if (explicitOptIn) return 'OPT_IN';
  return 'REVIEW_REQUIRED';
}

function classifyRisk(server) {
  const text = collectStrings(server).join(' ').toLowerCase();
  if (/shell|filesystem|browser automation|destructive|delete|write|accept|deploy|credential|token/i.test(text)) return 'HIGH_REVIEW';
  if (/search|read|docs|observability|analytics|query/i.test(text)) return 'READ_REVIEW';
  return 'UNKNOWN_REVIEW';
}

function buildMcpInventory(config, provenance) {
  if (!config || typeof config.mcpServers !== 'object') throw new Error('ECC MCP config has no mcpServers object');

  const servers = Object.entries(config.mcpServers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, server]) => {
      const transport = classifyTransport(server);
      const readiness = classifyReadiness(server);
      const risk = classifyRisk(server);
      const canonical = {
        server_id: `ecc.mcp.${crypto.createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 16)}`,
        name,
        transport,
        source_path: provenance.path,
        source_sha: provenance.sha,
        source_commit_sha: provenance.commit_sha,
        source_tag: provenance.tag,
        command: transport === 'stdio' ? (server.command || null) : null,
        args: transport === 'stdio' ? (server.args || []) : [],
        url: transport === 'http' ? (server.url || null) : null,
        readiness,
        risk,
        enabled: false,
        activation_status: 'PROPOSED',
        approval_required: true,
        credentials_required: collectStrings(server.env || {}).length > 0 || collectStrings(server.headers || {}).length > 0,
        placeholder_configuration: collectStrings(server).some(hasPlaceholder),
        description: typeof server.description === 'string' ? server.description : null,
      };
      return canonical;
    });

  const canonical = {
    schema: 'aria.ecc-mcp-inventory.v1',
    deterministic: true,
    source: {
      repository: 'https://github.com/affaan-m/ECC',
      tag: provenance.tag,
      commit_sha: provenance.commit_sha,
      path: provenance.path,
      sha: provenance.sha,
    },
    policy: {
      max_enabled_mcp: MAX_ENABLED_MCP,
      default_enabled: false,
      approval_required: true,
      placeholder_blocks_activation: true,
      no_secret_storage: true,
    },
    servers,
  };

  return {
    ...canonical,
    inventory_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      total_servers: servers.length,
      stdio: servers.filter(s => s.transport === 'stdio').length,
      http: servers.filter(s => s.transport === 'http').length,
      opt_in: servers.filter(s => s.readiness === 'OPT_IN').length,
      blocked_configuration: servers.filter(s => s.readiness === 'BLOCKED_CONFIGURATION').length,
      review_required: servers.filter(s => s.readiness === 'REVIEW_REQUIRED').length,
      enabled: servers.filter(s => s.enabled).length,
    },
  };
}

function buildActivationProposal(inventory, selectedNames = []) {
  if (!inventory || inventory.schema !== 'aria.ecc-mcp-inventory.v1') {
    throw new Error('Unsupported MCP inventory schema');
  }
  const wanted = [...new Set(selectedNames)];
  if (wanted.length > MAX_ENABLED_MCP) throw new Error(`MCP activation exceeds safe cap of ${MAX_ENABLED_MCP}`);

  const byName = new Map(inventory.servers.map(s => [s.name, s]));
  const selections = [];
  for (const name of wanted) {
    const server = byName.get(name);
    if (!server) throw new Error(`Unknown MCP server: ${name}`);
    if (server.placeholder_configuration) throw new Error(`MCP activation blocked by placeholder configuration: ${name}`);
    selections.push({
      server_id: server.server_id,
      name: server.name,
      requested: true,
      approved: false,
      enabled: false,
      activation_status: 'AWAITING_ARIA_APPROVAL',
      reason: server.readiness === 'OPT_IN' ? 'ECC_OPT_IN' : 'EXPLICIT_USER_SELECTION_REQUIRED',
    });
  }

  const proposal = {
    schema: 'aria.ecc-mcp-activation-proposal.v1',
    deterministic: true,
    inventory_digest_sha256: inventory.inventory_digest_sha256,
    policy: {
      max_enabled_mcp: MAX_ENABLED_MCP,
      approved_by_aria: false,
      enabled_count: 0,
      activation_mutation: false,
    },
    selections: selections.sort((a, b) => a.name.localeCompare(b.name)),
  };

  return {
    ...proposal,
    proposal_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(proposal), 'utf8').digest('hex'),
  };
}

async function fetchLockedMcpConfig({ fetchImpl = globalThis.fetch, commit_sha, tag }) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!commit_sha) throw new Error('ECC commit SHA is required');

  const url = `https://api.github.com/repos/affaan-m/ECC/contents/${ECC_MCP_PATH}?ref=${commit_sha}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'aria-ecc-mcp-bridge',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`ECC MCP config fetch failed: ${response.status}`);
  const payload = await response.json();
  if (payload.sha !== ECC_MCP_SHA) {
    throw new Error(`ECC MCP config SHA mismatch: expected ${ECC_MCP_SHA}, got ${payload.sha}`);
  }
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    throw new Error('ECC MCP config returned without base64 content');
  }

  const jsonText = Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8');
  const config = JSON.parse(jsonText);

  return buildMcpInventory(config, {
    repository: 'https://github.com/affaan-m/ECC',
    tag: tag || 'v2.2.3',
    commit_sha,
    path: ECC_MCP_PATH,
    sha: payload.sha,
  });
}

module.exports = {
  ECC_MCP_PATH,
  ECC_MCP_SHA,
  MAX_ENABLED_MCP,
  classifyTransport,
  classifyReadiness,
  classifyRisk,
  buildMcpInventory,
  buildActivationProposal,
  fetchLockedMcpConfig,
};
