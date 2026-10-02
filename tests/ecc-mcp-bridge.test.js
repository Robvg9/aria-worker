'use strict';

const assert = require('node:assert/strict');
const {
  MAX_ENABLED_MCP,
  classifyTransport,
  classifyReadiness,
  buildMcpInventory,
  buildActivationProposal,
} = require('../scripts/ecc-mcp-bridge');

assert.equal(MAX_ENABLED_MCP, 9);
assert.equal(classifyTransport({ type: 'http', url: 'https://example.com/mcp' }), 'http');
assert.equal(classifyTransport({ command: 'npx' }), 'stdio');

assert.equal(
  classifyReadiness({ description: 'Not enabled by default; opt-in only' }),
  'OPT_IN',
);
assert.equal(
  classifyReadiness({ env: { API_KEY: 'YOUR_KEY_HERE' }, description: 'requires token' }),
  'BLOCKED_CONFIGURATION',
);

const config = {
  mcpServers: {
    browser: {
      command: 'npx',
      args: ['-y', '@playwright/mcp', '--browser', 'chrome'],
      description: 'Browser automation',
    },
    memory: {
      command: 'npx',
      args: ['-y', 'memory-server'],
      description: 'Persistent memory',
    },
    jira: {
      command: 'uvx',
      args: ['jira'],
      env: { JIRA_API_TOKEN: 'YOUR_JIRA_API_TOKEN_HERE' },
      description: 'Jira issue tracking',
    },
    remote: {
      type: 'http',
      url: 'https://example.com/mcp',
      description: 'Read-only docs and search',
    },
  },
};

const inventory = buildMcpInventory(config, {
  tag: 'v2.2.3',
  commit_sha: 'commit',
  path: 'mcp-configs/mcp-servers.json',
  sha: 'sha',
});

assert.equal(inventory.schema, 'aria.ecc-mcp-inventory.v1');
assert.equal(inventory.summary.total_servers, 4);
assert.equal(inventory.summary.stdio, 3);
assert.equal(inventory.summary.http, 1);
assert.equal(inventory.summary.blocked_configuration, 1);
assert.equal(inventory.summary.enabled, 0);
assert.equal(inventory.policy.default_enabled, false);
assert.ok(inventory.servers.every(s => s.enabled === false));
assert.ok(inventory.servers.every(s => s.approval_required === true));

const proposal = buildActivationProposal(inventory, ['remote', 'memory']);
assert.equal(proposal.schema, 'aria.ecc-mcp-activation-proposal.v1');
assert.equal(proposal.policy.approved_by_aria, false);
assert.equal(proposal.policy.enabled_count, 0);
assert.ok(proposal.selections.every(s => s.approved === false && s.enabled === false));
assert.equal(proposal.proposal_digest_sha256.length, 64);

assert.throws(
  () => buildActivationProposal(inventory, ['jira']),
  /blocked by placeholder configuration/,
);

assert.throws(
  () => buildActivationProposal(inventory, Array.from({ length: 10 }, (_, i) => `mcp-${i}`)),
  /safe cap/,
);

const reversed = buildMcpInventory({
  mcpServers: Object.fromEntries(Object.entries(config.mcpServers).reverse()),
}, {
  tag: 'v2.2.3',
  commit_sha: 'commit',
  path: 'mcp-configs/mcp-servers.json',
  sha: 'sha',
});
assert.equal(inventory.inventory_digest_sha256, reversed.inventory_digest_sha256);

console.log('ECC MCP BRIDGE TEST: PASS');
