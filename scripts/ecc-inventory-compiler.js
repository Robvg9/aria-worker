'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LOCK = path.resolve(__dirname, '..', 'ecc', 'source-lock.json');
const DEFAULT_API = 'https://api.github.com';

const HARNESS_DIRS = new Map([
  ['.agents', 'agents-harness'],
  ['.claude', 'claude-code'],
  ['.claude-plugin', 'claude-plugin'],
  ['.codex', 'codex'],
  ['.codex-plugin', 'codex-plugin'],
  ['.cursor', 'cursor'],
  ['.gemini', 'gemini'],
  ['.hermes', 'hermes'],
  ['.kimi', 'kimi'],
  ['.kiro', 'kiro'],
  ['.openclaw', 'openclaw'],
  ['.opencode', 'opencode'],
  ['.pi', 'pi'],
  ['.qwen', 'qwen'],
  ['.zed', 'zed'],
  ['.trae', 'trae'],
  ['.adal', 'adal'],
  ['.codebuddy', 'codebuddy'],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function firstSegment(filePath) {
  return filePath.split('/')[0] || '';
}

function basenameWithoutExtension(filePath) {
  const name = path.posix.basename(filePath);
  return name.replace(/\.[^.]+$/, '');
}

function canonicalName(filePath, category) {
  const parts = filePath.split('/');
  if (category === 'skills' && parts[1]) return parts[1];
  if (category === 'agents') return basenameWithoutExtension(filePath);
  if (category === 'commands') return basenameWithoutExtension(filePath);
  if (category === 'workflows') return basenameWithoutExtension(filePath);
  if (category === 'hooks') return path.posix.basename(filePath);
  if (category === 'mcp') return path.posix.basename(filePath);
  return filePath;
}

function targetSurfaces(filePath) {
  const surfaces = new Set();
  for (const segment of filePath.split('/')) {
    const mapped = HARNESS_DIRS.get(segment);
    if (mapped) surfaces.add(mapped);
  }
  return [...surfaces].sort();
}

function classifyPath(filePath) {
  const p = filePath.replace(/^\.\//, '');

  if (/^ecc2\//.test(p)) return 'ecc2';
  if (/^agents\//.test(p)) return 'agents';
  if (/^skills\//.test(p)) return 'skills';
  if (/^commands\//.test(p) || /^legacy-command-shims\//.test(p)) return 'commands';
  if (/^rules\//.test(p)) return 'rules';
  if (/^hooks\//.test(p)) return 'hooks';
  if (/^mcp-configs\//.test(p) || p === '.mcp.json') return 'mcp';
  if (/^manifests\//.test(p)) return 'manifests';
  if (/^workflows\//.test(p)) return 'workflows';
  if (/^scripts\//.test(p)) return 'scripts';
  if (/^tests\//.test(p)) return 'tests';
  if (/^schemas\//.test(p)) return 'schemas';
  if (/^integrations\//.test(p)) return 'integrations';
  if (/^scaffolds\//.test(p)) return 'scaffolds';
  if (/^docs\//.test(p)) return 'docs';
  if (/^config\//.test(p)) return 'config';
  if (targetSurfaces(p).length) return 'harness-surface';
  if (/(^|\/)memory([./_-]|$)/i.test(p) || /(^|\/)\.ecc\/memory\//.test(p)) return 'memory';
  if (/(^|\/)sessions?([./_-]|$)/i.test(p)) return 'sessions';
  return 'other';
}

function capabilityKind(category) {
  switch (category) {
    case 'agents': return 'agent';
    case 'skills': return 'skill';
    case 'commands': return 'command';
    case 'hooks': return 'hook';
    case 'mcp': return 'mcp';
    case 'workflows': return 'workflow';
    case 'memory': return 'memory';
    case 'sessions': return 'session';
    case 'ecc2': return 'control-plane';
    case 'harness-surface': return 'adapter';
    default: return 'supporting-artifact';
  }
}

function normalizeTreeEntry(entry) {
  if (!entry || typeof entry.path !== 'string' || !entry.type || !entry.sha) {
    throw new Error('Invalid ECC tree entry');
  }

  const category = classifyPath(entry.path);
  return {
    path: entry.path,
    type: entry.type,
    sha: entry.sha,
    size: Number.isFinite(entry.size) ? entry.size : null,
    top_level: firstSegment(entry.path),
    category,
    capability_kind: capabilityKind(category),
    canonical_name: canonicalName(entry.path, category),
    target_surfaces: targetSurfaces(entry.path),
    status: 'DISCOVERED',
  };
}

function stableEntries(tree) {
  return tree.map(normalizeTreeEntry).sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.sha.localeCompare(b.sha);
  });
}

function digestEntries(entries) {
  const payload = JSON.stringify(entries);
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function summarize(entries) {
  const counts = {};
  for (const entry of entries) counts[entry.category] = (counts[entry.category] || 0) + 1;

  const capabilityCounts = {};
  for (const entry of entries) {
    if (entry.capability_kind === 'supporting-artifact') continue;
    capabilityCounts[entry.capability_kind] = (capabilityCounts[entry.capability_kind] || 0) + 1;
  }

  return {
    total_entries: entries.length,
    files: entries.filter((e) => e.type === 'blob').length,
    directories: entries.filter((e) => e.type === 'tree').length,
    category_counts: Object.fromEntries(Object.entries(counts).sort()),
    capability_counts: Object.fromEntries(Object.entries(capabilityCounts).sort()),
  };
}

function requiredSnapshotChecks(lock, entries) {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  for (const [requiredPath, expected] of Object.entries(lock.snapshot.files || {})) {
    const found = byPath.get(requiredPath);
    if (!found) throw new Error(`Locked source path missing from ECC tree: ${requiredPath}`);
    if (expected.git_blob_sha && found.sha !== expected.git_blob_sha) {
      throw new Error(
        `Locked SHA mismatch for ${requiredPath}: expected ${expected.git_blob_sha}, got ${found.sha}`,
      );
    }
    if (expected.version && found.path !== requiredPath) {
      throw new Error(`Invalid snapshot metadata for ${requiredPath}`);
    }
  }
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'aria-ecc-inventory-compiler',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response || !response.ok) {
    throw new Error(`ECC inventory fetch failed: ${response?.status || 'unknown'} ${url}`);
  }
  return response.json();
}

async function fetchLockedTree({ fetchImpl = globalThis.fetch, lock }) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  const commitUrl = `${DEFAULT_API}/repos/affaan-m/ECC/git/commits/${lock.upstream.commit_sha}`;
  const commit = await fetchJson(fetchImpl, commitUrl);
  if (commit.sha !== lock.upstream.commit_sha) {
    throw new Error(`ECC commit mismatch: expected ${lock.upstream.commit_sha}, got ${commit.sha}`);
  }
  if (!commit.tree || !commit.tree.sha) throw new Error('ECC commit has no tree SHA');

  const treeUrl = `${DEFAULT_API}/repos/affaan-m/ECC/git/trees/${commit.tree.sha}?recursive=1`;
  const tree = await fetchJson(fetchImpl, treeUrl);
  if (tree.sha !== commit.tree.sha) {
    throw new Error(`ECC tree mismatch: expected ${commit.tree.sha}, got ${tree.sha}`);
  }
  if (tree.truncated) {
    throw new Error('ECC recursive tree is truncated; refusing an incomplete inventory');
  }

  return {
    commit_sha: commit.sha,
    commit_tree_sha: commit.tree.sha,
    tree_entries: tree.tree || [],
  };
}

async function compileEccInventory({
  lockPath = DEFAULT_LOCK,
  fetchImpl = globalThis.fetch,
} = {}) {
  const lock = readJson(lockPath);
  if (lock.schema !== 'aria.ecc-source-lock.v1') {
    throw new Error(`Unsupported ECC source-lock schema: ${lock.schema}`);
  }
  if (lock.upstream?.tag_signature_verified !== true) {
    throw new Error('ECC source lock is not signature-verified');
  }

  const source = await fetchLockedTree({ fetchImpl, lock });
  const entries = stableEntries(source.tree_entries);
  requiredSnapshotChecks(lock, entries);

  return {
    schema: 'aria.ecc-live-inventory.v1',
    generated_at: new Date().toISOString(),
    source: {
      repository: lock.upstream.repository,
      tag: lock.upstream.tag,
      commit_sha: source.commit_sha,
      commit_tree_sha: source.commit_tree_sha,
      source_lock_schema: lock.schema,
    },
    deterministic: true,
    complete_tree: true,
    digest_sha256: digestEntries(entries),
    summary: summarize(entries),
    entries,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const inventory = await compileEccInventory();

  if (args.has('--summary')) {
    console.log(JSON.stringify({
      schema: inventory.schema,
      source: inventory.source,
      digest_sha256: inventory.digest_sha256,
      summary: inventory.summary,
    }, null, 2));
    return;
  }

  if (args.has('--json')) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  console.log(
    `ECC INVENTORY PASS — ${inventory.summary.total_entries} entries — digest ${inventory.digest_sha256}`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ECC INVENTORY FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  classifyPath,
  canonicalName,
  targetSurfaces,
  normalizeTreeEntry,
  stableEntries,
  digestEntries,
  summarize,
  compileEccInventory,
};
