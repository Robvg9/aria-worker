'use strict';

const crypto = require('node:crypto');

const BINDING_BY_KIND = Object.freeze({
  agent: 'aria.agent-runtime',
  skill: 'aria.skill-runtime',
  command: 'aria.command-runtime',
  workflow: 'aria.workflow-runtime',
  hook: 'aria.hook-runtime',
  mcp: 'aria.mcp-gateway',
  'control-plane': 'ecc2.control-plane',
  adapter: 'aria.harness-adapter',
});

function bindingFor(kind) {
  return BINDING_BY_KIND[kind] || null;
}

function compileCapabilityRegistry(registry, driftReport) {
  if (!registry || registry.schema !== 'aria.ecc-capability-registry.v1') {
    throw new Error('Unsupported capability registry schema');
  }
  if (!driftReport || driftReport.schema !== 'aria.ecc-drift-report.v1') {
    throw new Error('Capability Compiler requires a drift report');
  }
  if (driftReport.state !== 'CLEAN') {
    throw new Error('Capability Compiler refuses non-clean drift report');
  }
  if (registry.source?.commit_sha !== driftReport.source?.commit_sha) {
    throw new Error('Registry and drift report source commit mismatch');
  }

  const compiled = [];
  for (const capability of registry.capabilities || []) {
    const binding = bindingFor(capability.kind);
    if (!binding) continue;

    compiled.push({
      capability_id: capability.capability_id,
      kind: capability.kind,
      name: capability.name,
      source: {
        path: capability.source_path,
        sha: capability.source_sha,
        commit_sha: capability.source_commit,
        tag: capability.source_tag,
      },
      target_surfaces: [...(capability.target_surfaces || [])].sort(),
      runtime_binding: {
        key: binding,
        state: 'UNBOUND',
        entrypoint: null,
        adapter: null,
      },
      lifecycle: {
        source_state: capability.status,
        compile_state: 'COMPILED',
        activation_state: 'DISABLED',
        authorization_state: 'ARIA_CONTROLLED',
      },
      verification: {
        state: capability.verification_contract?.state || 'NOT_VERIFIED',
        evidence_refs: [],
      },
      permissions: [],
      dependencies: [],
    });
  }

  compiled.sort((a, b) =>
    a.capability_id.localeCompare(b.capability_id),
  );

  const canonical = {
    schema: 'aria.ecc-compiled-capabilities.v1',
    deterministic: true,
    source: {
      repository: registry.source.repository,
      tag: registry.source.tag,
      commit_sha: registry.source.commit_sha,
      registry_digest_sha256: registry.registry_digest_sha256,
    },
    compiled_capabilities: compiled,
  };

  const compileDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');

  return {
    ...canonical,
    compile_digest_sha256: compileDigest,
    summary: {
      total_compiled: compiled.length,
      total_bound: compiled.filter(x => x.runtime_binding.state === 'BOUND').length,
      total_disabled: compiled.filter(x => x.lifecycle.activation_state === 'DISABLED').length,
      kind_counts: Object.fromEntries(
        Object.entries(
          compiled.reduce((acc, x) => {
            acc[x.kind] = (acc[x.kind] || 0) + 1;
            return acc;
          }, {}),
        ).sort(),
      ),
    },
  };
}

module.exports = { bindingFor, compileCapabilityRegistry };
