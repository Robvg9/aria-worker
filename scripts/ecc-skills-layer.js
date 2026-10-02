'use strict';

const crypto = require('node:crypto');

function buildSkillsLayer(compiled) {
  if (!compiled || compiled.schema !== 'aria.ecc-compiled-capabilities.v1') {
    throw new Error('Unsupported compiled capability schema');
  }

  const skills = (compiled.compiled_capabilities || [])
    .filter(c => c.kind === 'skill')
    .map(c => ({
      capability_id: c.capability_id,
      name: c.name,
      source: { ...c.source },
      target_surfaces: [...c.target_surfaces].sort(),
      load_policy: 'ON_DEMAND',
      source_mode: 'LAZY_READ',
      instruction_state: 'NOT_LOADED',
      verification_state: c.verification.state,
      activation_state: 'DISABLED',
      execution_authority: 'ARIA_CONTROLLED',
      permissions: [],
      dependencies: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const canonical = {
    schema: 'aria.ecc-skills-layer.v1',
    deterministic: true,
    source: {
      repository: compiled.source.repository,
      tag: compiled.source.tag,
      commit_sha: compiled.source.commit_sha,
      compile_digest_sha256: compiled.compile_digest_sha256,
    },
    skills,
  };

  return {
    ...canonical,
    layer_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      total_skills: skills.length,
      loaded: 0,
      enabled: 0,
      execution_grants: 0,
    },
  };
}

module.exports = { buildSkillsLayer };
