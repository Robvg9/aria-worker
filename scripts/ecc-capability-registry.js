'use strict';

const crypto = require('node:crypto');

const HARNESS_ROOTS = new Set([
  '.agents',
  '.claude-plugin',
  '.codex-plugin',
  '.cursor',
  '.gemini',
  '.hermes',
  '.kimi',
  '.openclaw',
  '.opencode',
  '.pi',
  '.qwen',
  '.zed',
  '.trae',
  '.adal',
  '.codebuddy',
]);

function capabilityId(kind, name, sourceSha) {
  const raw = `ecc|v1|${kind}|${name}|${sourceSha}`;
  const suffix = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 24);
  return `ecc.${kind}.${suffix}`;
}

function addCapability(map, input) {
  const id = capabilityId(input.kind, input.name, input.sha);
  if (map.has(id)) throw new Error(`Duplicate capability_id generated: ${id}`);

  map.set(id, {
    capability_id: id,
    kind: input.kind,
    name: input.name,
    source_path: input.path,
    source_sha: input.sha,
    source_commit: input.commit_sha,
    source_tag: input.tag,
    target_surfaces: input.target_surfaces || [],
    status: 'DISCOVERED',
    risk: 'UNASSESSED',
    permissions: [],
    dependencies: [],
    verification_contract: {
      required: [
        'source-provenance',
        'contract-test',
        'security-review',
        'runtime-verification',
        'evidence-persistence',
      ],
      state: 'NOT_VERIFIED',
    },
    evidence_refs: [],
  });
}

function buildCapabilityRegistry(inventory) {
  if (!inventory || inventory.schema !== 'aria.ecc-live-inventory.v1') {
    throw new Error('Unsupported inventory schema');
  }
  if (!inventory.complete_tree || inventory.deterministic !== true) {
    throw new Error('Capability Registry requires a complete deterministic inventory');
  }
  if (!inventory.source?.commit_sha || !inventory.source?.tag) {
    throw new Error('Inventory source provenance is required');
  }

  const map = new Map();

  for (const entry of inventory.entries) {
    if (entry.type !== 'blob' && entry.type !== 'tree') continue;

    let kind = null;
    let name = null;

    let match = entry.path.match(/^agents\/([^/]+)\.md$/);
    if (match) {
      kind = 'agent';
      name = match[1];
    }

    match = entry.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (match) {
      kind = 'skill';
      name = match[1];
    }

    match = entry.path.match(/^commands\/([^/]+)\.md$/);
    if (match) {
      kind = 'command';
      name = match[1];
    }

    match = entry.path.match(/^workflows\/([^/]+)\.workflow\.js$/);
    if (match) {
      kind = 'workflow';
      name = match[1];
    }

    if (/^hooks\/.+/.test(entry.path) && entry.type === 'blob') {
      kind = 'hook';
      name = entry.path.slice('hooks/'.length);
    }

    if ((entry.path === '.mcp.json' || /^mcp-configs\/.+/.test(entry.path)) && entry.type === 'blob') {
      kind = 'mcp';
      name = entry.path === '.mcp.json' ? '.mcp.json' : entry.path.slice('mcp-configs/'.length);
    }

    if (entry.path === 'ecc2' && entry.type === 'tree') {
      kind = 'control-plane';
      name = 'ecc2';
    }

    if (HARNESS_ROOTS.has(entry.path) && entry.type === 'tree') {
      kind = 'adapter';
      name = entry.path;
    }

    if (!kind) continue;

    addCapability(map, {
      kind,
      name,
      path: entry.path,
      sha: entry.sha,
      commit_sha: inventory.source.commit_sha,
      tag: inventory.source.tag,
      target_surfaces: entry.target_surfaces,
    });
  }

  const capabilities = [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name);
  });

  const canonical = {
    schema: 'aria.ecc-capability-registry.v1',
    source: {
      repository: inventory.source.repository,
      tag: inventory.source.tag,
      commit_sha: inventory.source.commit_sha,
      inventory_digest_sha256: inventory.digest_sha256,
    },
    capabilities,
  };

  const registryDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');

  const kindCounts = {};
  for (const capability of capabilities) {
    kindCounts[capability.kind] = (kindCounts[capability.kind] || 0) + 1;
  }

  return {
    ...canonical,
    registry_digest_sha256: registryDigest,
    deterministic: true,
    summary: {
      total_capabilities: capabilities.length,
      kind_counts: Object.fromEntries(Object.entries(kindCounts).sort()),
      activation_count: 0,
      enabled_count: 0,
    },
  };
}

async function buildLiveCapabilityRegistry(options = {}) {
  const { compileEccInventory } = require('./ecc-inventory-compiler');
  const inventory = await compileEccInventory(options);
  return buildCapabilityRegistry(inventory);
}

async function main() {
  const registry = await buildLiveCapabilityRegistry();
  console.log(JSON.stringify({
    schema: registry.schema,
    source: registry.source,
    registry_digest_sha256: registry.registry_digest_sha256,
    summary: registry.summary,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ECC CAPABILITY REGISTRY FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  capabilityId,
  buildCapabilityRegistry,
  buildLiveCapabilityRegistry,
};
