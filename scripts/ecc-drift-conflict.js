'use strict';

const crypto = require('node:crypto');

function fingerprint(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

function analyzeDrift(inventory, registry) {
  if (!inventory || inventory.schema !== 'aria.ecc-live-inventory.v1') {
    throw new Error('Unsupported inventory schema');
  }
  if (!registry || registry.schema !== 'aria.ecc-capability-registry.v1') {
    throw new Error('Unsupported capability registry schema');
  }
  if (inventory.source.commit_sha !== registry.source.commit_sha) {
    return {
      schema: 'aria.ecc-drift-report.v1',
      state: 'DRIFT',
      deterministic: true,
      source: { inventory_commit: inventory.source.commit_sha, registry_commit: registry.source.commit_sha },
      findings: [{
        code: 'SOURCE_COMMIT_MISMATCH',
        severity: 'HIGH',
        message: 'Registry and inventory refer to different ECC commits',
      }],
      summary: { total_findings: 1, high: 1, medium: 0, low: 0 },
    };
  }

  const findings = [];
  const byId = new Map();
  const byKindName = new Map();
  const byPath = new Map();

  for (const capability of registry.capabilities || []) {
    const add = (map, key, value) => {
      const values = map.get(key) || [];
      values.push(value);
      map.set(key, values);
    };
    add(byId, capability.capability_id, capability);
    add(byKindName, `${capability.kind}::${capability.name}`, capability);
    add(byPath, capability.source_path, capability);
  }

  for (const [id, values] of byId) {
    if (values.length > 1) {
      findings.push({
        code: 'DUPLICATE_CAPABILITY_ID',
        severity: 'HIGH',
        key: id,
        paths: values.map(v => v.source_path).sort(),
      });
    }
  }

  for (const [key, values] of byKindName) {
    const signatures = new Set(values.map(v => `${v.source_path}::${v.source_sha}`));
    if (signatures.size > 1) {
      findings.push({
        code: 'CAPABILITY_NAME_DRIFT',
        severity: 'HIGH',
        key,
        sources: [...signatures].sort(),
      });
    }
  }

  for (const [path, values] of byPath) {
    const ids = new Set(values.map(v => v.capability_id));
    if (ids.size > 1) {
      findings.push({
        code: 'SOURCE_PATH_COLLISION',
        severity: 'HIGH',
        key: path,
        capability_ids: [...ids].sort(),
      });
    }
  }

  const crossKinds = new Map();
  for (const c of registry.capabilities || []) {
    const values = crossKinds.get(c.name) || [];
    values.push(c.kind);
    crossKinds.set(c.name, values);
  }
  for (const [name, kinds] of crossKinds) {
    const unique = [...new Set(kinds)].sort();
    if (unique.length > 1) {
      findings.push({
        code: 'CROSS_KIND_NAME_COLLISION',
        severity: 'MEDIUM',
        key: name,
        kinds: unique,
      });
    }
  }

  const liveIndex = new Map((inventory.entries || []).map(e => [e.path, e]));
  for (const capability of registry.capabilities || []) {
    const live = liveIndex.get(capability.source_path);
    if (!live) {
      findings.push({
        code: 'REGISTRY_SOURCE_MISSING',
        severity: 'HIGH',
        key: capability.capability_id,
        source_path: capability.source_path,
      });
      continue;
    }
    if (live.sha !== capability.source_sha) {
      findings.push({
        code: 'REGISTRY_SOURCE_SHA_DRIFT',
        severity: 'HIGH',
        key: capability.capability_id,
        source_path: capability.source_path,
        expected_sha: capability.source_sha,
        actual_sha: live.sha,
      });
    }
  }

  const uniqueFindings = new Map();
  for (const finding of findings) {
    uniqueFindings.set(
      fingerprint([finding.code, finding.key || '', finding.source_path || '', finding.expected_sha || '', finding.actual_sha || '']),
      finding,
    );
  }

  const canonicalFindings = [...uniqueFindings.values()].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of canonicalFindings) counts[finding.severity.toLowerCase()] += 1;

  return {
    schema: 'aria.ecc-drift-report.v1',
    state: canonicalFindings.length ? 'DRIFT' : 'CLEAN',
    deterministic: true,
    source: {
      repository: inventory.source.repository,
      tag: inventory.source.tag,
      commit_sha: inventory.source.commit_sha,
      inventory_digest_sha256: inventory.digest_sha256,
      registry_digest_sha256: registry.registry_digest_sha256,
    },
    findings: canonicalFindings,
    summary: {
      total_findings: canonicalFindings.length,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
    },
    policy: {
      auto_resolve: false,
      auto_activate: false,
      human_review_required_for_drift: true,
    },
  };
}

module.exports = { analyzeDrift };
