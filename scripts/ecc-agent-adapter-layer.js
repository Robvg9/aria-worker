'use strict';

const crypto = require('node:crypto');

function buildAgentAdapterLayer(compiled) {
  if (!compiled || compiled.schema !== 'aria.ecc-compiled-capabilities.v1') {
    throw new Error('Unsupported compiled capability schema');
  }

  const agents = (compiled.compiled_capabilities || [])
    .filter(c => c.kind === 'agent')
    .map(c => ({
      capability_id: c.capability_id,
      name: c.name,
      source: { ...c.source },
      target_surfaces: [...c.target_surfaces].sort(),
      adapter: {
        key: 'aria.agent-runtime',
        state: 'UNBOUND',
        entrypoint: null,
        transport: null,
      },
      lifecycle: {
        source_state: c.lifecycle.source_state,
        compile_state: c.lifecycle.compile_state,
        activation_state: 'DISABLED',
        authorization_state: 'ARIA_CONTROLLED',
      },
      invocation: {
        mode: 'DEFERRED',
        requires_context: true,
        requires_selection: true,
        requires_verification: true,
        execution_grants: 0,
      },
      permissions: [],
      dependencies: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const canonical = {
    schema: 'aria.ecc-agent-adapter-layer.v1',
    deterministic: true,
    source: {
      repository: compiled.source.repository,
      tag: compiled.source.tag,
      commit_sha: compiled.source.commit_sha,
      compile_digest_sha256: compiled.compile_digest_sha256,
    },
    agents,
  };

  return {
    ...canonical,
    adapter_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      total_agents: agents.length,
      bound: 0,
      enabled: 0,
      execution_grants: 0,
    },
  };
}

module.exports = { buildAgentAdapterLayer };
